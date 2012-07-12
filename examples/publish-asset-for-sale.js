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

var assetRegistration = {};

assetRegistration.run = function() {
  program
    .version('1.0.0')
    // setup the command line options
    .option('--public-key <pemfile>',
      'The file containing the public key (default: public.pem).')
    .option('--private-key <pemfile>',
      'The file containing the private key (default: private.pem).')
    .option('--asset-name <title>',
      'The asset name (default: \'Test Asset\').')
    .option('--price <dollars>',
      'The price (in dollars) of the asset (default: 0.05).')
    .option('--listing-service <listing_url>',
      'The base URL for the listing service (default: http://listings.dev.payswarm.com/)')
    .parse(process.argv);

  // initialize settings
  var publicKeyPemFile = program.publicKey || 'public.pem';
  var privateKeyPemFile = program.privateKey || 'private.pem';
  var assetName = program.assetName || 'Test Asset';
  var price = program.price || '0.05';
  var payswarmAuthority = program.authority || 'http://dev.payswarm.com/';

  /*
   * To publish an asset for sale, the following steps must be performed:
   *
   * 1. Create and digitally sign the asset.
   * 2. Create and digitally sign the listing.
   * 3. Publish the asset and listing data to the Web.
   */
  async.waterfall([
    function(callback) {
      console.log("TODO: Implement the creation/registration process");
    }], function (err) {
      if(err) {
        console.log('Error', err);
      }
    });
};

// log uncaught exception and exit
process.on('uncaughtException', function(err) {
  console.log(
    err.toString(), err.stack ? {stack: err.stack} : null);
  process.removeAllListeners('uncaughtException');
  process.exit();
});

// run the program
assetRegistration.run();

