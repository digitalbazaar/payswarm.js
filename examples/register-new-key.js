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
    function(newCfg, callback) {
      cfg = newCfg;
      if(!('publicKey' in cfg)) {
        console.log("Generating new public/private keypair...");
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
      // retrieve the configuration for the Web Keys endpoints
      var webKeysUrl = URL.parse(payswarmAuthority, true, true);
      payswarm.getWebKeysConfig(webKeysUrl.host, callback);
    },
    function(endpoints, callback) {
      // generate the key registration URL
      var registrationUrl = URL.parse(endpoints.publicKeyService, true, true);
      registrationUrl.query['public-key'] = cfg.publicKey.publicKeyPem;
      registrationUrl.query['response-nonce'] =
        new Date().getTime().toString(16);
      delete registrationUrl.search;
      registrationUrl = URL.format(registrationUrl);
      console.log(
        'To register your new key, go to this URL using a Web browser:\n',
        registrationUrl);

      // read the encrypted message from the command line
      // NOTE: Cannot use buffered input as it is limited to 4096 bytes
      //       and encrypted messages are usually greater than that size.
      console.log("Then, enter the encrypted registration message:");

      process.stdin.resume();
      var encryptedMessage = '';
      require('tty').setRawMode(true);
      process.stdin.on('keypress', function (chunk, key) {
        encryptedMessage += chunk;
        process.stdout.write(chunk);
        if(key && key.name == 'enter') {
          process.stdout.write(chunk);
          process.stdin.pause();
          callback(null, JSON.parse(encryptedMessage));
        }
      });
    },
    function(encryptedMessage, callback) {
      payswarm.decrypt(encryptedMessage,
        {privateKey: cfg.publicKey.privateKeyPem}, callback);
    },
    function(message, callback) {
      console.log("DM: ", message);
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
