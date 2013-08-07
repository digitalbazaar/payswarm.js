/**
 * PaySwarm access keys tool.
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

'use strict';

var URL = require('url');
var async = require('async');
var common = require('./common');
var fs = require('fs');
var jsonld = require('./jsonld');
var payswarm = require('..');
var prompt = require('prompt');
var util = require('util');

function init(options) {
  var cmd = options.program
    .command('keys [key]')
    .description('manage access keys');
  common
    .command
    .init(cmd)
    .option('    --id <id>', 'id to use [access key owner]')
    .option('-l, --list', 'list keys [default]')
    .option('-r, --register', 'register new key')
    .option('    --overwrite', 'overwrite config file with new key [false]')
    .action(keys);
}

function keys(key, cmd) {
  var single = (typeof key !== 'undefined');
  async.auto({
    init: function(callback, results) {
      cmd.list = !!cmd.list;
      cmd.register = !!cmd.register;
      cmd.overwrite = !!cmd.overwrite;

      var count = (single + cmd.list + cmd.register);
      if(count > 1) {
        return callback(new Error('Only one command at a time allowed.'));
      }

      // default to list
      if(count ===  0) {
        cmd.list = true;
      }

      callback(null);
    },
    single: ['init', function(callback, results) {
      if(!single) {
        return callback(null);
      }
      list(cmd, key, callback);
    }],
    list: ['init', function(callback, results) {
      if(!cmd.list) {
        return callback(null);
      }
      list(cmd, null, callback);
    }],
    register: ['init', function(callback, results) {
      if(!cmd.register) {
        return callback(null);
      }
      register(cmd, callback);
    }]
  }, function(err) {
    common.error(err);
  });
}

function list(cmd, key, callback) {
  async.waterfall([
    function(callback) {
      common.config.read(cmd, callback);
    },
    function(cfg, callback) {
      // default id to key owner from config
      cmd.id = cmd.id || cfg.owner;

      if(!cmd.id) {
        return callback(new Error('No id or key owner found.'));
      }

      var url = common.makeId(cmd.id + '/keys', key);
      // FIXME: check cross authority id

      common.request(cmd, url, callback);
    },
    function(res, result, callback) {
      common.output(cmd, result, callback);
    }
  ], function(err) {
    common.error(err);
    callback();
  });
}

function register(cmd, callback) {
  /*
   * To register a key, the following steps must be performed:
   *
   * 1. Generate a public/private keypair (or use an existing one).
   * 2. Fetch the Web Keys registration endpoint from the PaySwarm Authority.
   * 3. Generate the key registration URL and go to it in a browser.
   * 4. Get the new key information and provide it to the program.
   */
  async.auto({
    config: function(callback) {
      // read the config file
      common.config.read(cmd, {strict: false}, callback);
    },
    configCheck: ['config', function(callback, results) {
      // early check for overwrite option if file exists
      if(!cmd.overwrite) {
        return fs.exists(cmd.config, function(exists) {
          if(exists) {
            return callback(new Error('Config exists: ' + cmd.config));
          }
          callback(null);
        });
      }
      callback(null);
    }],
    keys: ['configCheck', function(callback, results) {
      // Step #1: Generate a public/private keypair (or use an existing one).
      if(!('publicKey' in results.config)) {
        console.log('Generating new public/private keypair...');
        payswarm.createKeyPair(function(err, pair) {
          // update the configuration object with the new key info
          results.config.publicKey = {};
          results.config.publicKey.publicKeyPem = pair.publicKey;
          results.config.publicKey.privateKeyPem = pair.privateKey;
          callback(null);
        });
      }
      else {
        callback(null);
      }
    }],
    endpoints: ['configCheck', function(callback, results) {
      // Step #2: Fetch the Web Keys endpoint from the PaySwarm Authority.
      var webKeysUrl = URL.parse(results.config.authority, true, true);
      var options = {
        request: common.requestOptions(cmd)
      };
      payswarm.getWebKeysConfig(webKeysUrl.host, options, callback);
    }],
    encryptedMessagePrompt: ['keys', 'endpoints', function(callback, results) {
      // Step #3: Generate the key registration URL
      var registrationUrl =
        URL.parse(results.endpoints.publicKeyService, true, true);
      registrationUrl.query['public-key'] =
        results.config.publicKey.publicKeyPem;
      registrationUrl.query['response-nonce'] =
        new Date().getTime().toString(16);
      delete registrationUrl.search;
      registrationUrl = URL.format(registrationUrl);
      console.log(
        'To register your new key, go to this URL using a Web browser:\n',
        registrationUrl);
      callback();
    }],
    encryptedMessage: ['encryptedMessagePrompt', function(callback, results) {
      // read the encrypted message from the command line
      prompt.start();
      prompt.get({
        properties: {
          encryptedMessage: {
            description: 'Enter the encrypted registration message:'
          }
        }
      }, function(err, results) {
        if(err) {
          return callback(err);
        }
        callback(null, JSON.parse(results.encryptedMessage));
      });
    }],
    message: ['encryptedMessage', function(callback, results) {
      payswarm.decrypt(results.encryptedMessage, {
        privateKey: results.config.publicKey.privateKeyPem
      }, callback);
    }],
    updateConfig: ['message', function(callback, results) {
      // Step #4: Get the new key information
      results.config.publicKey.id = results.message.publicKey;
      results.config.owner = results.message.owner;
      results.config.source = results.message.destination;
      callback();
    }],
    writeConfig: ['updateConfig', function(callback, results) {
      common.config.write(cmd, results.config, {overwrite: true}, callback);
    }],
    done: ['updateConfig', function(callback, results) {
      console.log('Completed registration of new public key:');
      console.log('   Public Key Owner :', results.config.owner);
      console.log('   Financial Account:', results.config.source);
      console.log('   Public Key URL   :', results.config.publicKey.id);
      callback();
    }]
  }, function(err) {
    common.error(err);
    callback();
  });
}

module.exports = {
  init: init
};

if(require.main === module) {
  common.error('Run this tool with the payswarm application.');
}
