/**
 * Example of how to create and publish an asset for sale.
 *
 * @author Manu Sporny
 * @author Dave Longley
 *
 * Copyright (c) 2011-2014, Digital Bazaar, Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * * Neither the name of Digital Bazaar, Inc. nor the names of its contributors
 *   may be used to endorse or promote products derived from this software
 *   without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
var async = require('async');
var payswarm = require('../lib/payswarm-client.js');
var program = require('commander');

program
  .version(module.exports.version)
  // setup the command line options
  .option('-c, --config <config>',
    'The PaySwarm configuration file. [~/.config/payswarm1/default]')
  .option('-n, --asset-name <title>',
    'The asset name [\'Test Asset ' + assetId + '\']')
  .option('-p, --price <dollars>',
    'The price (in dollars) of the asset [0.05]')
  .option('-l, --listing-service <listing_url>',
    'The base URL for the listing service [http://listings.dev.payswarm.com/]')
  .option('-v, --verbose',
    'Print more detailed program status updates [false].')
  .parse(process.argv);

// log uncaught exception and exit
process.on('uncaughtException', function(err) {
  console.log(err.toString(), err.stack ? {stack: err.stack} : null);
  process.removeAllListeners('uncaughtException');
  process.exit();
});

// initialize settings
var configName = program.config || null;
var assetId = Date.now().toString(16);
var assetName = program.assetName || 'Test Asset ' + assetId;
var price = program.price || '0.05';
var listingService = (program.listingService ||
  'http://listings.dev.payswarm.com/');
var verbose = program.verbose || false;

// generate the asset and listing validity dates (use the same ones in
// this simple example, but an asset may have a validity range that is
// larger than the listing's)
var validFrom = new Date();
var validUntil = new Date();
validUntil.setFullYear(validFrom.getFullYear() + 1);

/*
 * To publish an asset for sale, the following steps must be performed:
 *
 * 1. Create and digitally sign the asset.
 * 2. Create and digitally sign the listing.
 * 3. Publish the asset and listing data to the Web.
 */
async.auto({
  getConfig: function(callback) {
    payswarm.readConfig(configName, function(err, config) {
      if(err) {
        console.log('Error: Failed to find a PaySwarm configuration file.');
        return callback(err);
      }
      callback(null, config);
    });
  },
  createAsset: ['getConfig', function(callback, results) {
    // Step #1: Create the asset and digitally sign it
    console.log('Generating and signing asset...');
    var config = results.getConfig;
    var assetUrl = listingService + 'payswarm.js/' + assetId;
    var asset = {
      '@context': payswarm.CONTEXT_URL,
      id: assetUrl + '#asset',
      type: ['Asset', 'pto:WebPage'],
      creator: {
        fullName: 'publish-asset-for-sale.js Example'
      },
      title: assetName,
      assetContent: assetUrl,
      assetProvider: config.owner,
      listingRestrictions: {
        validFrom: payswarm.w3cDate(validFrom),
        validUntil: payswarm.w3cDate(validUntil),
        payee: [{
          id: assetUrl + '#asset-payee-1',
          type: 'Payee',
          destination: config.source,
          currency: 'USD',
          payeeGroup: ['assetProvider'],
          payeeRate: '80',
          payeeRateType: 'Percentage',
          payeeApplyType: 'ApplyInclusively',
          payeeApplyGroup: ['vendor'],
          minimumAmount: '0.01',
          comment: 'Asset Provider Royalty'
        }],
        payeeRule: [{
          type: 'PayeeRule',
          payeeGroupPrefix: ['authority']
        }, {
          type: 'PayeeRule',
          payeeGroup: ['vendor'],
          payeeRateType: 'FlatAmount',
          payeeApplyType: 'ApplyExclusively'
        }]
      }
    };

    // sign the asset
    payswarm.sign(asset, {
      key: config.privateKey.privateKeyPem,
      keyId: config.publicKey.id
    }, callback);
  }],
  hashAsset: ['createAsset', function(callback, results) {
    // generate a hash for the signed asset
    payswarm.hash(results.createAsset, callback);
  }],
  createListing: ['hashAsset', function(callback, results) {
    // Step #2: Create and digitally sign the listing
    console.log('Generating and signing listing...');
    var config = results.getConfig;
    var listingUrl = listingService + 'payswarm.js/' + assetId;
    var listing = {
      '@context': payswarm.CONTEXT_URL,
      id: listingUrl + '#listing',
      type: ['Listing', 'gr:Offering'],
      vendor: config.owner,
      payee: [{
        id: listingUrl + '#listing-payee-1',
        type: 'Payee',
        destination: config.source,
        currency: 'USD',
        payeeGroup: ['vendor'],
        payeeRate: price,
        payeeRateType: 'FlatAmount',
        payeeApplyType: 'ApplyExclusively',
        comment: 'Payment for selling Test Asset ' + assetId + '.'
      }],
      payeeRule : [{
        type: 'PayeeRule',
        payeeGroupPrefix: ['authority'],
        maximumPayeeRate: '10',
        payeeRateType: 'Percentage',
        payeeApplyType: 'ApplyInclusively'
      }],
      asset: listingUrl + '#asset',
      assetHash: results.hashAsset,
      license: 'https://w3id.org/payswarm/licenses/blogging',
      licenseHash: 'urn:sha256:' +
        'd9dcfb7b3ba057df52b99f777747e8fe0fc598a3bb364e3d3eb529f90d58e1b9',
      validFrom: payswarm.w3cDate(validFrom),
      validUntil: payswarm.w3cDate(validUntil)
    };

    // sign the listing
    payswarm.sign(listing, {
      key: config.publicKey.privateKey.privateKeyPem,
      keyId: config.publicKey.id
    }, callback);
  }],
  post: ['createListing', function(callback, results) {
    // Step #3: Register the signed asset and listing
    console.log('Register asset and listing...');
    var assetAndListing = {
      '@context': payswarm.CONTEXT_URL,
      '@graph': [results.createAsset, results.createListing]
    };
    var url = results.createListing.id.split('#')[0];
    payswarm.postJsonLd(url, assetAndListing, function(err) {
      callback(err, assetAndListing);
    });
  }]
}, function(err, results) {
  if(err) {
    console.log('Failed to register signed asset and listing: ' + err);
    return;
  }
  // display registration details
  if(verbose) {
    console.log('Registered signed asset and listing: ' +
      JSON.stringify(results.post, null, 2));
  } else {
    console.log('Registered signed asset:\n   ',
      results.post['@graph'][0].id);
    console.log('Registered signed listing:\n   ',
      results.post['@graph'][1].id);
  }
});
