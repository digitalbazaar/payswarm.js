/**
 * PaySwarm URL tool.
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

var URL = require('url');
var async = require('async');
var common = require('./common');
var payswarm = require('..');

function init(options) {
  var cmd = options.program
    .command('url <url>')
    .description('raw REST protocol access [WARNING]');
  common
    .command
    .init(cmd)
    .option('-X, --method <method>', 'HTTP method [GET, POST with --data]')
    .option('-d, --data <data>', 'JSON-LD string, @file for file, @- for stdin')
    .option('    --cross-authority', 'allow a cross-authority request [false]')
    .action(url)
    .on('--help', function() {
      console.log();
      console.log('  WARNING: Be careful with this tool!');
      console.log();
      console.log('  Raw authority access with the REST PaySwarm protocol.');
      console.log('  You can perform low-level actions with proper use of');
      console.log('  this tool. See the PaySwarm specification for details.');
      console.log();
      console.log('  NOTE: The cross authority check only checks host:port.');
      console.log();
    });
}

function url(url, cmd) {
  async.waterfall([
    function(callback) {
      common.config.read(cmd, callback);
    },
    function(cfg, callback) {
      if(!cmd.crossAuthority) {
        // check for cross-authority request
        var keyurl = URL.parse(cfg.publicKey.id);
        var authurl = URL.parse(url);
        if(keyurl.host !== authurl.host && !cmd.crossAuthority) {
          var msg =
            "Cross-authority requests disabled." +
            " Use --cross-authority to override.";
          return callback(new Error(msg));
        }
      }
      callback(null, cfg);
    },
    function(cfg, callback) {
      if(cmd.data) {
        if(cmd.data.length > 0 && cmd.data[0] === '@') {
          // FIXME: handle non-JSON-LD data
          payswarm.getJsonLd(cmd.data.slice(1), function(err, data) {
            if(err) {
              return callback(err);
            }
            callback(null, cfg, data);
          });
          return;
        }
        else {
          return callback(null, cfg, cmd.data);
        }
      }
      callback(null, cfg, null);
    },
    function(cfg, data, callback) {
      if(!url) {
        return callback(null, cfg);
      }
      var opts = {
        httpSignature: {
          keyId: cfg.publicKey.id,
          key: cfg.publicKey.privateKeyPem
        }
      };
      // default to POST if --data used
      if(cmd.data) {
        opts.method = 'POST';
      }
      // override method, will default to GET
      if(cmd.method) {
        opts.method = cmd.method;
      }
      if(data) {
        opts.body = JSON.stringify(data);
      }
      common.request(cmd, url, opts, callback);
    },
    function(res, data, callback) {
      common.output(cmd, data, callback);
      callback();
    }
  ], function(err) {
    common.error(err);
  });
}

module.exports = {
  init: init
};

if(require.main === module) {
  common.error('Run this tool with the payswarm application.');
}
