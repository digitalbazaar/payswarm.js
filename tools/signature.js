/**
 * PaySwarm signature tool.
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
var payswarm = require('..');

function init(options) {
  var cmd = options.program
    .command('signature')
    .description('Sign and verify JSON-LD');
  common
    .command
    .init(cmd)
    .option('    --nonce <nonce>', 'nonce to use when signing')
    .option('    --created <created>', 'W3C date to use when signing')
    .option('    --sign <data>',
      'Sign JSON-LD string, @file for file, @- for stdin')
    .option('    --verify <data>',
      'Verify JSON-LD string, @file for file, @- for stdin')
    .action(signature)
    .on('--help', function() {
      console.log();
      console.log('  Signatures are performed using the current config.');
      console.log('  Verification will fetch the public key.');
      console.log();
    });
}

function signature(cmd) {
  async.auto({
    cfg: function(callback) {
      common.config.read(cmd, callback);
    },
    signData: ['cfg', function(callback, results) {
      if(cmd.sign) {
        if(cmd.sign.length > 0 && cmd.sign[0] === '@') {
          // FIXME: handle non-JSON-LD data
          payswarm.getJsonLd(cmd.sign.slice(1), function(err, data) {
            if(err) {
              return callback(err);
            }
            callback(null, data);
          });
          return;
        }
        else {
          return callback(null, JSON.parse(cmd.sign));
        }
      }
      callback();
    }],
    sign: ['signData', function(callback, results) {
      if(results.signData) {
        var opts = {
          publicKeyId: results.cfg.publicKey.id,
          privateKeyPem: results.cfg.publicKey.privateKeyPem
        };
        if(cmd.nonce) {
          opts.nonce = cmd.nonce;
        }
        if(cmd.created) {
          opts.dateTime = cmd.created;
        }

        return payswarm.sign(results.signData, opts, function(err, signed) {
          if(err) {
            return callback(err);
          }
          common.output(cmd, signed, callback);
        });
      }
      callback();
    }],
    verifyData: ['cfg', 'sign', function(callback, results) {
      if(cmd.verify) {
        if(cmd.verify.length > 0 && cmd.verify[0] === '@') {
          // FIXME: handle non-JSON-LD data
          payswarm.getJsonLd(cmd.verify.slice(1), function(err, data) {
            if(err) {
              return callback(err);
            }
            callback(null, data);
          });
          return;
        }
        else {
          return callback(null, JSON.parse(cmd.verify));
        }
      }
      callback();
    }],
    verify: ['verifyData', function(callback, results) {
      if(results.verifyData) {
        var options = {
          request: common.requestOptions(cmd)
        };
        return payswarm.verify(results.verifyData, options, function(err) {
          if(err) {
            return callback(err);
          }
          if(cmd.verbose) {
            console.log('OK');
          }
          callback();
        });
      }
      callback();
    }],
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
