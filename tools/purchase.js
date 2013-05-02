/**
 * PaySwarm purchase tool.
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

'use strict';

var async = require('async');
var common = require('./common');
var jsonld = require('./jsonld');
var payswarm = require('..');
var prompt = require('prompt');

function init(options) {
  var cmd = options.program
    .command('purchase [listing]')
    .description('purchase a listing [WARNING]');
  common
    .command
    .init(cmd)
    .option('    --source <account_url>',
      'URL for the financial account to use when purchasing.')
    .action(purchase)
    .on('--help', function() {
      console.log();
      console.log('  WARNING: Be careful with this tool!');
      console.log();
      console.log('  This tool will perform purchase on your behalf on a');
      console.log('  PaySwarm Authority using a real account. Under most');
      console.log('  circumstances, these purchases are made with legally');
      console.log('  binding contracts.');
      console.log();
    });
}

function purchase(listing, cmd) {
  /*
   * To purchase an asset, the following steps must be performed.
   *
   * 1. Retrieve the listing and generate a hash for the listing.
   * 2. Send a purchase request for the listing and retrieve the receipt.
   */
  async.auto({
    config: function(callback) {
      common.config.read(cmd, callback);
    },
    init: ['config', function(callback, results) {
      // check for source override
      if(cmd.source) {
        results.config.source = cmd.source;
      }

      callback(null);
    }],
    listingUrl: ['init', function(callback, results) {
      if(listing) {
        return callback(null, listing);
      }

      // get the listing purchase URL from stdin if not already specified
      prompt.start();
      prompt.get({
        properties: {
          listing: {
            description: 'Enter the URL of the listing you want to purchase'
          }
        }
      }, function(err, results) {
        if(err) {
          return callback(err);
        }
        callback(null, results.listing);
      });
    }],
    source: ['listing', function(callback, results) {
      if(results.config.source) {
        return callback(null, results.config.source);
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
        callback(null, results.source);
      });
    }],
    listing: ['listingUrl', function(callback, results) {
      // Step #1: Retrieve the listing from the Web
      var options = common.requestOptions(cmd);
      options.cache = true;
      payswarm.getJsonLd(results.listingUrl, options, callback);
    }],
    confirm: ['config', 'source', 'listing', function(callback, results) {
      if(cmd.yes) {
        callback(null, true);
      }
      // quick details
      console.log('Listing ID:', results.listingUrl);
      console.log('Source Account ID:', results.source);
      // FIXME: Get quote and output amount and/or other details
      //console.log('Amount: %s %s',
      //  results.quote.currency, results.quote.amount);
      prompt.start();
      prompt.get({
        properties: {
          confirm: {
            description: 'Perform purchase?',
            pattern: '^(yes|y|true|t|1|no|n|false|f|0)$',
            default: 'no',
            required: true
          }
        }
      }, function(err, results) {
        if(err) {
          return callback(err);
        }
        try {
          callback(null, common.boolify(results.confirm));
        }
        catch(ex) {
          callback(ex);
        }
      });
    }],
    purchase: ['confirm', function(callback, results) {
      if(!results.confirm) {
        // skip purchase
        return callback();
      }
      // Step #2: Send a purchase request for the listing
      payswarm.purchase(results.listing, {
        // FIXME: URL should be retrieved via a .well-known/payswarm method
        transactionService: results.config.authority + 'transactions',
        customer: results.config.owner,
        source: results.source,
        publicKey: results.config.publicKey.id,
        privateKeyPem: results.config.publicKey.privateKeyPem,
        verbose: cmd.verbose,
        request: common.requestOptions(cmd)
      }, callback);
    }],
    receipt: ['purchase', function(callback, results) {
      var receipt = results.purchase;
      var err = null;
      if(!results.confirm) {
        // skip output
      }
      else if(!receipt) {
        err = new Error('No receipt.');
      }
      else if(jsonld.hasValue(receipt, 'type', 'Receipt')) {
        // print the receipt of sale to the console
        var contract = receipt.contract;
        console.log('Successfully purchased:', contract.listing);
        console.log('Transaction ID:', contract.id);
        if(cmd.verbose) {
          console.log('Receipt:');
          common.output(receipt);
        }
      }
      else {
        // bad receipt
        err = callback(new Error('Receipt:' +
          JSON.stringify(receipt, null, 2)));
      }
      callback(err);
    }]
  }, function(err) {
    common.error(err);
  });
}

module.exports = {
  init: init
};

if(require.main === module) {
  common.error('Run this tool with the payswarm application.');
}
