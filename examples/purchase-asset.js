/**
 * Example of how to purchase an asset from the Web.
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
var prompt = require('prompt');
var URL = require('url');

program
  .version(module.exports.version)
  // setup the command line options
  .option('-c, --config <config>',
    'The configuration containing public/private keys.')
  .option('-l, --listing <listing_url>',
    'URL for the listing to purchase.')
  .option('-s, --source <account_url>',
    'URL for the financial account to use when purchasing.')
  .option('-p, --payment-processor <payment_processor_url>',
    'The base URL for the payment processor ' +
    '(default: https://dev.payswarm.com/).')
  .option('-v, --verbose',
    'Print out debugging information to the console (default: false).')
  .parse(process.argv);

// log uncaught exception and exit
process.on('uncaughtException', function(err) {
  console.log(err.toString(), err.stack ? {stack: err.stack} : null);
  process.removeAllListeners('uncaughtException');
  process.exit();
});

// initialize settings
var configName = program.config || null;
var ppp = program.paymentProcessor || 'https://dev.payswarm.com/';
var verbose = program.verbose || false;

/*
 * To purchase an asset, the following steps must be performed.
 *
 * 1. Retrieve the listing and generate a hash for the listing.
 * 2. Send a purchase request for the listing and retrieve the receipt.
 */
async.async({
  getConfig: function(callback) {
    // read the config file from disk
    payswarm.readConfig(configName, function(err, config) {
      if(err) {
        console.log('Error: Failed to find a PaySwarm configuration file.');
        return callback(err);
      }
      // overlay the command line configuration data
      if(program.listing) {
        config.listingUrl = program.listing;
      }
      if(program.source) {
        config.source = program.source;
      }
      callback(null, config);
    });
  },
  getListingUrl: ['getConfig', function(callback, results) {
    var config = results.getConfig;
    if(config.listingUrl) {
      return callback();
    }

    // get the listing purchase URL from stdin if not already specified
    prompt.start();
    prompt.get({
      properties: {
        listingUrl: {
          description: 'Enter the URL of the listing you want to purchase'
        }
      }
    }, function(err, results) {
      if(err) {
        return callback(err);
      }
      config.listingUrl = results.listingUrl;
      callback();
    });
  }],
  getSource: ['getListingUrl', function(callback, results) {
    var config = results.getConfig;
    if(config.source) {
      return callback();
    }

    // get the source financial account for the purchase if not specified
    prompt.start();
    prompt.get({
      properties: {
        source: {
          description: 'Financial account URL (source of funds)'
        }
      }
    }, function(err, results) {
      if(err) {
        return callback(err);
      }
      config.source = results.source;
      callback();
    });
  }],
  getPaySwarmConfig: function(callback) {
    // get payswarm config from payment processor
    var url = URL.parse(ppp, true, true);
    payswarm.getWellKnownConfig(url.host, {service: 'payswarm'}, callback);
  },
  getListing: ['getSource', function(callback, results) {
    // Step #1: Retrieve the listing from the Web
    payswarm.getJsonLd(results.config.listingUrl, callback);
  }],
  purchase: ['getListing', 'getPaySwarmConfig', function(callback, results) {
    var config = results.getConfig;
    var listing = results.getListing;
    var payswarmConfig = results.getPaySwarmConfig;

    // Step #2: Send a purchase request for the listing
    payswarm.purchase(listing, {
      // FIXME: URL should be payswarmConfig.transactionService
      transactionService: ppp + 'transactions',//payswarmConfig.transactionService
      customer: config.owner,
      source: config.source,
      publicKey: config.publicKey.id,
      privateKeyPem: config.publicKey.privateKeyPem,
      verbose: verbose
    }, callback);
  }],
  displayReceipt: ['purchase', function(callback, results) {
    var receipt = results.purchase;
    if(!(receipt && receipt.type && receipt.type === 'Receipt')) {
      return callback(new Error("[purchase-asset.js] receipt:" +
        JSON.stringify(receipt, null, 2)));
    }

    if(verbose) {
      console.log('purchase-asset - Purchase successful:',
        JSON.stringify(receipt, null, 2));
      return callback();
    }
    // print the receipt of sale to the console
    var contract = receipt.contract;
    console.log('Successfully purchased', contract.listing, '...');
    console.log('Transaction ID:', contract.id);
    callback();
  }]
}, function(err) {
  if(err) {
    console.log('Purchase error:', err);
  }
});
