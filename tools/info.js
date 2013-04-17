/**
 * PaySwarm resource info tool.
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

function init(options) {
  var cmd = options.program
    .command('info <location>')
    .description('display resource information');
  common
    .command
    .init(cmd)
    .option('    --base-uri <base>', 'base URI to use []')
    .option('    --all', 'show full and all sub-resources [true]')
    .option('    --full', 'show full resource [false]')
    .option('    --assets', 'show only Assets [false]')
    .option('    --licenses', 'show only Licenses [false]')
    .option('    --listings', 'show only Listings [false]')
    .option('    --raw', 'show compacted raw JSON-LD [false]')
    .option('    --framed', 'show framed JSON-LD [true]')
    .option('    --hash', 'show JSON-LD hahes [true]')
    .option('    --normalized', 'show normalized N-Quads [false]')
    .action(info)
    .on('--help', function() {
      console.log();
      console.log('  Displays information from a resource. The location can')
      console.log('  be stdin, a file, or a HTTP/HTTPS resource.')
      console.log();
      console.log('  By default the full resource and common PaySwarm types');
      console.log('  are processed unless explicit options are specified.');
      console.log();
      console.log('  The framed JSON-LD and hashes are output by default');
      console.log('  unless --framed, --hash, or --normalized are specified.');
      console.log();
      console.log('  Also see the jsonld tool from the jsonld.js project.');
      console.log();
    });
}

function info(loc, cmd) {
  async.waterfall([
    function(callback) {
      common.command.config(cmd, callback);
    },
    function(cfg, callback) {
      cmd.base = cmd.base || '';

      // data type options
      cmd.all = !!cmd.all;
      cmd.full = !!cmd.full || cmd.all;
      cmd.assets = !!cmd.assets || cmd.all;
      cmd.licenses = !!cmd.licenses || cmd.all;
      cmd.listings = !!cmd.listings || cmd.all;
      // enable everything if none explicitly enabled
      if(!cmd.full && !cmd.assets && !cmd.licenses && !cmd.listings) {
        cmd.full = cmd.assets = cmd.licenses = cmd.listings = true;
      }

      // output options
      cmd.raw = !!cmd.raw;
      cmd.framed = !!cmd.framed;
      cmd.hash = !!cmd.hash;
      cmd.normalized = !!cmd.normalized;
      // enable framed and hash display if none explicitly enabled
      if(!cmd.framed && !cmd.hash && !cmd.normalized) {
        cmd.framed = cmd.hash = true;
      }

      console.log('Location:\n%s', (loc || '[stdin]'));
      common.request(cmd, loc, function(err, res, data) {
        if(err) {
          return callback(err);
        }
        callback(err, data);
      });
    },
    function(data, callback) {
      if(cmd.raw) {
        var ctx = payswarm.CONTEXT_URL;
        return jsonld.compact(data, ctx, function(err, compacted) {
          console.log('Raw:');
          common.output(cmd, compacted, function(err) {
            if(err) {
              return callback(err);
            }
            callback(null, data);
          });
        });
      }
      callback(null, data);
    },
    function(data, callback) {
      if(cmd.all || cmd.full) {
        return processType(data, null, cmd, callback);
      }
      callback(null, data);
    },
    function(data, callback) {
      if(cmd.all || cmd.assets) {
        return processType(data, 'Asset', cmd, callback);
      }
      callback(null, data);
    },
    function(data, callback) {
      if(cmd.all || cmd.licenses) {
        return processType(data, 'License', cmd, callback);
      }
      callback(null, data);
    },
    function(data, callback) {
      if(cmd.all || cmd.listings) {
        return processType(data, 'Listing', cmd, callback);
      }
      callback(null, data);
    }
  ], function(err) {
    if(err) {
      common.error(cmd, err);
    }
  });
}

function processType(data, type, cmd, callback) {
  async.waterfall([
    function(callback) {
      if(!type) {
        return callback(null, data);
      }
      var frames = payswarm.FRAMES;
      if(!(type in frames)) {
        return callback(new Error({
          message: 'No frame for type.',
          type: 'payswarm.InfoTool.InvalidType',
          details: {
            type: type
          }
        }));
      }
      var frame = frames[type];
      if(cmd.verbose) {
        console.log('Frame[%s]:\n%s',
          type || '*', JSON.stringify(frame, null, 2));
      }
      jsonld.frame(data, frame, {base: cmd.base}, function(err, framed) {
        if(err) {
          return callback(err);
        }
        if(cmd.framed) {
          console.log('Framed[%s]:\n%s',
            type || '*', JSON.stringify(framed, null, 2));
        }
        callback(null, framed);
      });
    },
    function(data, callback) {
      if(cmd.hash) {
        return payswarm.hash(data, function(err, hash) {
          if(err) {
            // FIXME: better handling of empty hash
            console.log('Hash[%s]:\n[no data or error]', type || '*');
            return callback(null, data);
            //return callback(err);
          }
          console.log('Hash[%s]:\n%s', type || '*', hash);
          callback(null, data);
        });
      }
      callback(null, data);
    },
    function(data, callback) {
      if(cmd.normalized) {
        var opts = {base: cmd.base, format: 'application/nquads'};
        return jsonld.normalize(data, opts, function(err, normalized) {
          if(err) {
            return callback(err);
          }
          console.log('Normalized[%s]:\n%s', type || '*', normalized.trim());
          callback(null, data);
        });
      }
      callback(null);
    }
  ], function(err) {
    if(err) {
      return callback(err);
    }
    callback(null, data);
  });
}

module.exports = {
  init: init
};

if(require.main === module) {
  console.error('Error: Run this tool with the payswarm application.');
  process.exit(1);
}
