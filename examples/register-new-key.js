/**
 * Example of how to create and register a new public/private key pair.
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
var prompt = require('prompt');
var program = require('commander');
var URL = require('url');

program.version(module.exports.version)
  // setup the command line options
  .option('-c, --config <config>',
    'The PaySwarm configuration file [~/.config/payswarm1/default]')
  .option('-s, --web-keys-service <web-keys-service>',
    'The base URL for the Web Keys Service ' +
    '[https://dev.payswarm.com/]')
  .parse(process.argv);

process.on('uncaughtException', function(err) {
  // log uncaught exception and exit
  console.log(err.toString(), err.stack ? {stack: err.stack} : null);
  process.removeAllListeners('uncaughtException');
  process.exit();
});

// initialize settings
var configName = program.config || null;
var cfg = {};
var wks = program.webKeysService || 'https://dev.payswarm.com/';

/*
 * To register a key, the following steps must be performed:
 *
 * 1. Generate a public/private key pair (or use an existing one).
 * 2. Fetch the Web Keys config from the Web Keys Service.
 * 3. Generate the key registration URL and go to it in a browser.
 * 4. Get the new key information and provide it to the program.
 */
async.auto({
  getConfig: function(callback) {
    payswarm.getConfigFilename(configName, function(err, filename) {
      if(err) {
        return callback(err);
      }
      // read the config file from disk
      console.log('Reading config from: "' + filename + '"...');
      payswarm.readConfig(configName, function(err, config) {
        if(err) {
          // TODO: ensure config file can be written to before continuing
          console.log(err);
        }
        callback(null, config);
      });
    });
  },
  readKey: ['getConfig', function(callback, results) {
    var config = results.getConfig;
    // Step #1: Generate a public/private key pair (or use an existing one).
    if(config.publicKey) {
      return callback();
    }

    console.log('Generating new public/private key pair...');
    payswarm.createKeyPair(function(err, pair) {
      if(err) {
        return callback(err);
      }
      // update config with new key info
      config.publicKey = {
        publicKeyPem: pair.publicKey,
        privateKey: {
          privateKeyPem: pair.privateKey
        }
      };
      payswarm.writeConfig(configName, config, function(err) {
        if(err) {
          console.log(err);
          process.exit();
        }
        callback();
      });
    });
  }],
  getWebKeysConfig: function(callback) {
    // Step #2: Fetch the Web Keys config from the Web Keys Service.
    var url = URL.parse(wks, true, true);
    payswarm.getWellKnownConfig(url.host, {service: 'web-keys'}, callback);
  },
  getUrl: ['readKey', 'getWebKeysConfig', function(callback, results) {
    // Step #3: Generate the key registration URL
    var responseNonce = Date.now().toString(16);
    var registrationUrl = URL.parse(
      results.getWebKeysConfig.publicKeyService, true, true);
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
      properties: {
        data: {
          description: 'Then, enter the encrypted registration message',
          require: true,
        }
      }
    }, callback);
  }],
  decrypt: ['getUrl', function(callback, results) {
    var encryptedMessage = JSON.parse(results.getUrl.data);
    payswarm.decrypt(encryptedMessage, {
      privateKey: cfg.publicKey.privateKey.privateKeyPem
    }, callback);
  }],
  updateKey: ['decrypt', function(callback, results) {
    // Step #4: Get the new key information
    var config = results.getConfig;
    config.publicKey.id = results.decrypt.publicKey;
    config.owner = results.decrypt.owner;
    config.source = results.decrypt.destination;
    payswarm.writeConfig(configName, config, callback);
  }],
}, function(err, results) {
  if(err) {
    console.log('[register-new-key] failed to register key:\n', err.stack);
    return;
  }
  var config = results.getConfig;
  var filename = results.updateKey;
  console.log('Completed registration of new public key:');
  console.log('   Public Key Owner :', config.owner);
  console.log('   Financial Account:', config.source);
  console.log('   Public Key URL   :', config.publicKey.id);
  console.log('Config written to: "' + filename + '"');
});
