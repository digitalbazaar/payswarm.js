/**
 * Example of how to create and register a new public/private keypair.
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
var pkginfo = require('pkginfo')(module, 'version');
var prompt = require('prompt');
var program = require('commander');
var URL = require('url');

var keyRegistration = {};

keyRegistration.run = function() {
  program.version(module.exports.version)
    // setup the command line options
    .option('-c, --config <config>',
      'The PaySwarm configuration file [~/.config/payswarm1/default]')
    .option('-a, --authority <authority>',
      'The base URL for the PaySwarm Authority [https://dev.payswarm.com/]')
    .parse(process.argv);

  // initialize settings
  var configName = program.config || null;
  var cfg = {};
  var payswarmAuthority = program.authority || 'https://dev.payswarm.com/';

  /*
   * To register a key, the following steps must be performed:
   *
   * 1. Generate a public/private keypair (or use an existing one).
   * 2. Fetch the Web Keys registration endpoint from the PaySwarm Authority.
   * 3. Generate the key registration URL and go to it in a browser.
   * 4. Get the new key information and provide it to the program.
   */
  async.waterfall([
    function(callback) {
      payswarm.getConfigFilename(configName, callback);
    },
    function(configFilename, callback) {
      // read the config file from disk
      console.log('Reading config from: "' + configFilename + '"...');
      payswarm.readConfig(configName, function(err, psCfg) {
        if(err) {
          // TODO: ensure config file can be written to before continuing
          console.log(err);
        }
        callback(null, psCfg);
      });
    },
    function(newCfg, callback) {
      cfg = newCfg;
      // Step #1: Generate a public/private keypair (or use an existing one).
      if(!('publicKey' in cfg)) {
        console.log('Generating new public/private keypair...');
        payswarm.createKeyPair(function(err, pair) {
          // update the configuration object with the new key info
          cfg.publicKey = {};
          cfg.publicKey.publicKeyPem = pair.publicKey;
          cfg.publicKey.privateKeyPem = pair.privateKey;
          payswarm.writeConfig(configName, cfg, function(err, configFilename) {
            if(err) {
              return console.log(err);
            }
            callback();
          });
        });
      } else {
        callback(null);
      }
    },
    function(callback) {
      // Step #2: Fetch the Web Keys endpoint from the PaySwarm Authority.
      var webKeysUrl = URL.parse(payswarmAuthority, true, true);
      payswarm.getWebKeysConfig(webKeysUrl.host, callback);
    },
    function(endpoints, callback) {
      // Step #3: Generate the key registration URL
      var responseNonce = new Date().getTime().toString(16);
      var registrationUrl = URL.parse(endpoints.publicKeyService, true, true);
      registrationUrl.query['public-key'] = cfg.publicKey.publicKeyPem;
      registrationUrl.query['response-nonce'] = responseNonce;
      delete registrationUrl.search;
      registrationUrl = URL.format(registrationUrl);
      console.log(
        '\nTo register your new key, go to this URL using a Web browser:\n\n' +
        registrationUrl + '\n');

      // read the encrypted message from the command line
      prompt.start();
      prompt.get({
        properties : {
          data : {
            description : 'Then, enter the encrypted registration message',
            require : true,
          }
        }
      }, callback);
    },
    function(message, callback) {
      var encryptedMessage = JSON.parse(message.data);
      payswarm.decrypt(encryptedMessage, {
        privateKey : cfg.publicKey.privateKeyPem
      }, callback);
    },
    function(message, callback) {
      // Step #4: Get the new key information
      cfg.publicKey.id = message.publicKey;
      cfg.owner = message.owner;
      cfg.source = message.destination;
      callback();
    },
    function(callback) {
      payswarm.writeConfig(configName, cfg, function(err, configFilename) {
        callback(err, configFilename, cfg);
      });
    },
    function(configFilename, cfg, callback) {
      console.log('Completed registration of new public key:');
      console.log('   Public Key Owner :', cfg.owner);
      console.log('   Financial Account:', cfg.source);
      console.log('   Public Key URL   :', cfg.publicKey.id);
      console.log('Config written to: "' + configFilename + '"');
    }], function(err) {
    if(err) {
      console.log('[register-new-key] failed to register key:\n', err.stack);
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
