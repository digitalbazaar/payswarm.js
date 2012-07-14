/**
 * Example of how to purchase an asset from the Web.
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
var prompt = require('prompt');
var request = require('request');

var assetRegistration = {};

assetRegistration.run = function() {
  program
    .version('1.0.0')
    // setup the command line options
    .option('--config <configfile>',
      'The configuration containing public/private keys.')
    .option('--listing <listing_url>',
      'URL for the listing to purchase.')
    .option('--source <account_url>',
      'URL for the financial account to use when purchasing.')
    .option('--authority <authority_url>',
      'The base URL for the authority (default: https://dev.payswarm.com/).')
    .parse(process.argv);

  // initialize settings
  var configFile = program.config || 'payswarm.cfg';
  var config = {};
  var authority = program.authority || 'https://dev.payswarm.com/';

  /*
   * To purchase an asset, the following steps must be performed.
   *
   * 1. Retrieve the listing and generate a hash for the listing.
   * 2. Send a purchase request for the listing and retrieve the receipt.
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
    function(config, callback) {
      if(!config.listingUrl) {
        prompt.start();

        // get the listing purchase URL
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
          callback(null, config);
        });
      }
      else {
        callback(null, config);
      }
    },
    function(config, callback) {
      if(!config.source) {
        prompt.start();

        // get the source financial account for the purchase
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
          callback(null, config);
        });
      }
      else {
        callback(null, config);
      }
    },
    function(config, callback) {
      // retrieve the listing
      request.get(config.listingUrl, {}, function(err, response, body) {
        if(!err && response.statusCode >= 400) {
          err = Error('HTTP ' + response.statusCode + ':\n  ' + body);
        }
        if(err) {
          console.log('Failed to retrieve listing information: ',
            err.toString());
          return callback(err);
        }

        // build the purchase request
        var data = JSON.parse(body);
        // FIXME: Use a JSON-LD frame here... or iterate.
        var listing = data['@graph'][1];

        // generate the listing hash
        listing['@context'] = 'http://purl.org/payswarm/v1';
        payswarm.hash(listing, function(err, hash) {
          if(err) {
            return callback(err);
          }

          // generate the purchase request
          var purchaseRequest = {
              '@context': 'http://purl.org/payswarm/v1',
              type: 'ps:PurchaseRequest',
              identity: config.publicKey.owner,
              listing: listing.id,
              listingHash: hash,
              source: config.source
            };

          callback(null, purchaseRequest);
        });
      });
    },
    function(purchaseRequest, callback) {
      console.log('PR:', JSON.stringify(purchaseRequest, null, 2));
      // sign the purchase request and send it to the PaySwarm Authority
      payswarm.sign(purchaseRequest, {
        publicKeyId: config.publicKey.id,
        privateKeyPem: config.publicKey.privateKeyPem
      }, function(err, signedRequest) {
        if(err) {
          return callback(err);
        }
        // FIXME: This should be performed in payswarm.js
        signedRequest['@context'] = 'http://purl.org/payswarm/v1';
        request.post({
          url: authority + '/transactions',
          json: signedRequest
        }, function(err, response, body) {
          if(!err && response.statusCode >= 400) {
            err = JSON.stringify(body, null, 2);
          }
          if(err) {
            console.log('Failed to purchase asset: ', err.toString());
            return callback(err);
          }

          var receipt = body;
          console.log('Purchase receipt: ' + JSON.stringify(receipt, null, 2));
          callback();
        });
      });
    }
  ], function(err) {
    if(err) {
      console.log('Failed purchase:',
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
