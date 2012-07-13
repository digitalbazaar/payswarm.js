/**
 * Example of how to create and publish an asset for sale.
 *
 * @author Manu Sporny
 *
 * BSD 3-Clause License
 * Copyright (c) 2011-2012 Digital Bazaar, Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * Redistributions in binary form must reproduce the above copyright
 * notice, this list of conditions and the following disclaimer in the
 * documentation and/or other materials provided with the distribution.
 *
 * Neither the name of the Digital Bazaar, Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
 * IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
 * TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
 * PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var async = require('async');
var program = require('commander');
var payswarm = require('../lib/payswarm-client.js');
var path = require('path');
var fs = require('fs');
var querystring = require('querystring');
var request = require('request');

var assetRegistration = {};

assetRegistration.run = function() {
  var assetId = new Date().getTime().toString(16);
  program
    .version('1.0.0')
    // setup the command line options
    .option('--config <configfile>',
      'The configuration containing public/private keys.')
    .option('--asset-name <title>',
      'The asset name (default: \'Test Asset ' + assetId + '\').')
    .option('--price <dollars>',
      'The price (in dollars) of the asset (default: 0.05).')
    .option('--listing-service <listing_url>',
      'The base URL for the listing service (default: http://listings.dev.payswarm.com/)')
    .option('--verbose',
      'Print more detailed program status updates (default: false).')
    .parse(process.argv);

  // initialize settings
  var configFile = program.config || 'payswarm.cfg';
  var config = {};
  var assetName = program.assetName || 'Test Asset ' + assetId;
  var price = program.price || '0.05';
  var listingService = program.listingService || 'http://listings.dev.payswarm.com/';
  var verbose = program.verbose || false;

  /*
   * To publish an asset for sale, the following steps must be performed:
   *
   * 1. Create and digitally sign the asset.
   * 2. Create and digitally sign the listing.
   * 3. Publish the asset and listing data to the Web.
   */
  async.waterfall([
    function(callback) {
      // read the config file
      fs.readFile(configFile, 'utf8', function(err, data) {
        if(err) {
          // file does not exist error
          if(err.code === 'ENOENT') {
            console.log(
              'The config file named ' + configFile + ' does not exist.');
            return callback(err);
          }
        }

        // Read the configuration file
        console.log('Reading public key information from ' + configFile);
        config = JSON.parse(data);
        callback(null, config);
      });
    },
    function(config, callback) {
      // generate the asset
      var assetUrl = listingService + 'payswarm.js/' + assetId;
      var asset = {
        id: assetUrl + '#asset',
        type: ['ps:Asset', 'pto:WebPage'],
        creator: {
          fullName: 'publish-asset-for-sale.js Example'
        },
        title: assetName,
        assetContent: assetUrl,
        assetProvider: config.publicKey.owner,
      };

      // set the options to use when signing the asset
      var signingOptions = {};
      signingOptions.publicKeyId = config.publicKey.id;
      signingOptions.privateKeyPem = config.publicKey.privateKeyPem;

      // sign the asset
      payswarm.sign(asset, signingOptions, callback);
    },
    function(signedAsset, callback) {
      // generate a hash for the signed asset
      payswarm.hash(signedAsset, function(err, assetHash) {
        callback(err, signedAsset, assetHash);
      });
    },
    function(signedAsset, assetHash, callback) {
      // generate the listing validity dates
      var validFrom = new Date();
      var validUntil = new Date();
      validUntil.setFullYear(validFrom.getFullYear() + 1);

      // generate the listing
      var listingUrl = listingService + 'payswarm.js/' + assetId;

      var listing = {
        id: listingUrl + '#listing',
        type: ['ps:Listing', 'gr:Offering'],
        payee: [{
          id: listingUrl + '#listing-payee-1',
          type: 'com:Payee',
          destination: 'https://payswarm.dev:19443/i/vendor/accounts/primary',
          payeePosition: 0,
          payeeRate: price,
          payeeRateType: 'com:FlatAmount',
          comment: 'Payment for Test Asset ' + assetId + '.'
        }],
        payeeRule : [{
          type: 'com:PayeeRule',
          accountOwnerType: 'ps:Authority',
          maximumPayeeRate: '10.0000000',
          payeeRateContext: ['com:Inclusive', 'com:Tax', 'com:TaxExempt'],
          payeeRateType: 'com:Percentage'
        }],
        asset: assetId,
        assetHash: assetHash,
        license: 'http://purl.org/payswarm/licenses/blogging',
        licenseHash: 'ad8f72fcb47e867231d957c0bffb4c02d275926a',
        validFrom: validFrom,
        validUntil: validUntil,
      };

      // set the options to use when signing the listing
      var signingOptions = {};
      signingOptions.publicKeyId = config.publicKey.id;
      signingOptions.privateKeyPem = config.publicKey.privateKeyPem;

      // sign the listing
      payswarm.sign(listing, signingOptions,
        function(err, signedListing) {
          callback(err, signedAsset, signedListing);
      });
    },
    function(signedAsset, signedListing, callback) {
      // register the signed listing
      var assetAndListing = {
        '@context': 'http://purl.org/payswarm/v1',
        '@graph': [signedAsset, signedListing]
      };

      request.post({
        headers: {'content-type': 'application/ld+json'},
        url: signedListing.id.split('#')[0],
        body: JSON.stringify(assetAndListing, null, 2)
      }, function(err, response, body) {
        if(!err && response.statusCode >= 400) {
          err = JSON.stringify(body, null, 2);
        }
        if(err) {
          console.log('Failed to register signed asset and listing: ',
            err.toString());
          return callback(err);
        }

        if(verbose) {
          console.log('Registered signed asset and listing: ' +
            JSON.stringify(assetAndListing, null, 2));
        }
        else {
          console.log('Registered signed asset: ', signedAsset.id);
          console.log('Registered signed listing: ', signedListing.id);
        }
        callback(null);
      });
    }], function(err) {
      if(err) {
        console.log('Failed to register signed asset and listing:',
          err.toString());
      }
  });
};

// log uncaught exception and exit
process.on('uncaughtException', function(err) {
  console.log(err.toString(), err.stack ? {stack: err.stack} : null);
  process.removeAllListeners('uncaughtException');
  process.exit();
});

// run the program
assetRegistration.run();
