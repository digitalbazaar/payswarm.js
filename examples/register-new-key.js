/**
 * Example of how to create and register a new public/private keypair.
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
var prompt = require('prompt');
var config = require('./config.js');
var payswarm = require('../lib/payswarm-client.js');
var fs = require('fs');
var URL = require('url');

var keyRegistration = {};

keyRegistration.run = function() {
  program
    .version('1.0.0')
    // setup the command line options
    .option('--config <configfile>',
      'The file containing the public & private keys (default: payswarm.cfg).')
    .option('--authority <authority_url>',
      'The base URL for the PaySwarm Authority (default: http://dev.payswarm.com/)')
    .parse(process.argv);

  // initialize settings
  var cfgFile = program.config || 'payswarm.cfg';
  var cfg = {};
  var payswarmAuthority = program.authority || 'http://dev.payswarm.com/';

  /*
   * To register a key, the following steps must be performed:
   *
   * 1. Generate a public/private keypair (or use an existing one).
   * 2. Fetch the Web Keys registration endpoint from the PaySwarm Authority.
   * 3. Generate the key registration URL and go to it in a browser.
   * 4. Get the new key's URL.
   */
  async.waterfall([
    function(callback) {
      // read the config file from disk
      config.readConfigFile(cfgFile, callback);
    },
    function(newCfg, callback)
    {
      cfg = newCfg;
      if(!('publicKey' in cfg)) {
        payswarm.createKeyPair({keySize: 1024}, function(err, pair) {
          // update the configuration object with the new key info
          cfg.publicKey = {};
          cfg.publicKey.publicKeyPem = pair.publicKey;
          cfg.publicKey.privateKeyPem = pair.privateKey;
          config.writeConfigFile(cfgFile, cfg, callback);
        });
      }
      else {
        callback();
      }
    },
    function(callback) {
      // TODO: retrieve key registration end-point
      var endpoints = {
        publicKeyService: payswarmAuthority + 'keys'
      };
      callback(null, endpoints.publicKeyService);
    },
    function(registrationEndpoint, callback) {
      // generate the key registration URL
      var registrationUrl = URL.parse(registrationEndpoint, true);
      registrationUrl.query['public-key'] = cfg.publicKey.publicKeyPem;
      registrationUrl = URL.format(registrationUrl);
      console.log(
        'To register your new key, go to this URL using a Web browser:\n',
        registrationUrl);

      // get the registered key URL
      prompt.start();
      prompt.get({
        properties: {
          publicKey: {
            description: 'Then, enter your new public key URL'
          },
          owner: {
            description: 'Enter the URL for the owner of the public key'
          }
        }
      }, function(err, results) {
        if(err) {
          return callback(err);
        }
        cfg.publicKey.id = results.publicKey;
        cfg.publicKey.owner = results.owner;
        callback(null);
      });
    },
    function(callback) {
      config.writeConfigFile(cfgFile, cfg, callback);
      console.log('Completed registration of new public key.');
    }
  ], function (err) {
    if(err) {
      console.log('Error', err);
    }
  });
};

process.on('uncaughtException', function(err) {
  // log uncaught exception and exit
  console.log(err.toString(), err.stack ? {stack: err.stack} : null);
  process.removeAllListeners('uncaughtException');
  process.exit();
});

// run the program
keyRegistration.run();
