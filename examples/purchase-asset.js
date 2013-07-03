/**
 * Example of how to purchase an asset from the Web.
 *
 * @author Manu Sporny
 *
 * Copyright (c) 2011-2013, Digital Bazaar, Inc.
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
 * * Neither the name of the Digital Bazaar, Inc. nor the names of its
 *   contributors may be used to endorse or promote products derived from this
 *   software without specific prior written permission.
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
var pkginfo = require('pkginfo')(module, 'version');
var program = require('commander');
var prompt = require('prompt');

var assetRegistration = {};

assetRegistration.run = function() {
  program
    .version(module.exports.version)
    // setup the command line options
    .option('-c, --config <config>',
      'The configuration containing public/private keys.')
    .option('-l, --listing <listing_url>',
      'URL for the listing to purchase.')
    .option('-s, --source <account_url>',
      'URL for the financial account to use when purchasing.')
    .option('-a, --authority <authority_url>',
      'The base URL for the authority (default: https://dev.payswarm.com/).')
    .option('-v, --verbose',
      'Print out debugging information to the console (default: false).')
    .parse(process.argv);

  // initialize settings
  var configName = program.config || null;
  var cfg = {};
  var authority = program.authority || 'https://dev.payswarm.com/';
  var verbose = program.verbose || false;

  /*
   * To purchase an asset, the following steps must be performed.
   *
   * 1. Retrieve the listing and generate a hash for the listing.
   * 2. Send a purchase request for the listing and retrieve the receipt.
   */
  async.waterfall([
    function(callback) {
      // read the config file from disk
      payswarm.readConfig(configName, function(err, psCfg) {
        if(err) {
          console.log('Error: Failed to find a PaySwarm configuration file.');
          return callback(err);
        }
        callback(null, psCfg);
      });
    },
    function(newCfg, callback) {
      cfg = newCfg;
      // overlay the command line configuration data
      if(program.listing) {
        cfg.listingUrl = program.listing;
      }
      if(program.source) {
        cfg.source = program.source;
      }
      callback();
    },
    function(callback) {
      if(cfg.listingUrl) {
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
        cfg.listingUrl = results.listingUrl;
        callback();
      });
    },
    function(callback) {
      if(cfg.source) {
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
        cfg.source = results.source;
        callback();
      });
    },
    function(callback) {
      // Step #1: Retrieve the listing from the Web
      payswarm.getJsonLd(cfg.listingUrl, {cache: true}, callback);
    },
    function(listing, callback) {
      // Step #2: Send a purchase request for the listing
      payswarm.purchase(listing, {
        // FIXME: URL should be retrieved via a .well-known/payswarm method
        transactionService: authority + 'transactions',
        customer: cfg.owner,
        source: cfg.source,
        publicKey: cfg.publicKey.id,
        privateKeyPem: cfg.publicKey.privateKeyPem,
        verbose: verbose
      }, callback);
    },
    function(receipt, callback) {
      if(receipt && receipt.type && receipt.type === 'Receipt') {
        if(verbose) {
          console.log('purchase-asset - Purchase successful:',
            JSON.stringify(receipt, null, 2));
        }
        else {
          // print the receipt of sale to the console
          var contract = receipt.contract;
          console.log('Successfully purchased', contract.listing, '...');
          console.log('Transaction ID:', contract.id);
        }
        callback();
      }
      else
      {
        callback(new Error("[purchase-asset.js] receipt:" +
          JSON.stringify(receipt, null, 2)));
      }
    }], function(err) {
    if(err) {
      console.log('Purchase error:', err);
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
