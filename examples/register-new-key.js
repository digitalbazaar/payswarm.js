/**
 * Example of how to create an register a new public/private keypair.
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

var keyRegistration = {};

keyRegistration.run = function() {
  program
    .version('1.0.0')
    // setup the command line options
    .option('--public-key <pemfile>',
      'The file containing the public key (default: public.pem).')
    .option('--private-key <pemfile>',
      'The file containing the private key (default: private.pem).')
    .option('--authority <authority_url>',
      'The base URL for the PaySwarm Authority (default: http://dev.payswarm.com/)')
    .parse(process.argv);

  // initialize settings
  var publicKeyPemFile = program.publicKey || 'public.pem';
  var privateKeyPemFile = program.privateKey || 'private.pem';
  var payswarmAuthority = program.authority || 'http://dev.payswarm.com/';

  /*
   * To register a key, the following steps must be performed:
   *
   * 1. Generate a public/private keypair (or use an existing one).
   * 2. Fetch the Web Keys registration endpoint from the PaySwarm Authority.
   * 3. Generate the registration URL.
   */
  async.waterfall([
    function(callback) {
      // check to see if the public key PEM file exists
      path.exists(publicKeyPemFile, function(exists) {
        callback(null, exists);
      });
    },
    function(exists, callback) {
      // if the public key file exists, use the contents - if not, generate keys
      if(exists) {
        // get information on the public key file
        fs.stat(publicKeyPemFile, function(err, stats) {
          if(err) {
            callback(err);
          }
          if(stats.isFile()) {
            // get the data in the public key file
            fs.readFile(publicKeyPemFile, 'utf8', function(err, data) {
              if(err) {
                return callback(err);
              }

              // format the public key data for the next step in the process
              console.log('Reading existing public key from ' +
                publicKeyPemFile);
              var pair = {};
              pair.publicKey = data;
              callback(null, pair, false);
            });
          }
        });
      }
      else {
        // generate a new public/private keypair
        payswarm.createKeyPair({keySize: 512}, function(err, pair) {
          callback(err, pair, true);
        });
      }
    },
    function(pair, writeToFile, callback) {
      if(writeToFile) {
        // write the generated keys to disk
        console.log('Wrote new public key to ' + publicKeyPemFile);
        fs.writeFile(publicKeyPemFile, pair.publicKey);
        console.log('Wrote new private key to ' + privateKeyPemFile);
        fs.writeFile(privateKeyPemFile, pair.privateKey);
      }
      callback(null, pair.publicKey);
    },
    function(publicKeyPem, callback) {
      // TODO: retrieve key registration end-point
      var endpoints = {
        publicKeyService: payswarmAuthority + 'keys'
      };
      callback(null, endpoints.publicKeyService, publicKeyPem);
    },
    function(registrationEndpoint, publicKeyPem, callback) {
      // generate the key registration URL
      var registrationUrl = registrationEndpoint + '?' +
        querystring.stringify({'public-key': publicKeyPem});
      console.log('Register your public key by going to the following link:\n',
        registrationUrl);
      callback();
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
keyRegistration.run();

