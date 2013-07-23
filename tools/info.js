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
    .option('    --context <context>', 'context used to expand data []')
    .option('    --all', 'show full and all sub-resources [true]')
    .option('    --full', 'show full resource [false]')
    .option('    --assets', 'show only Assets [false]')
    .option('    --licenses', 'show only Licenses [false]')
    .option('    --listings', 'show only Listings [false]')
    .option('    --raw', 'show compacted raw JSON-LD [false]')
    .option('    --framed', 'show framed JSON-LD [true]')
    .option('    --hash', 'show JSON-LD hahes [true]')
    .option('    --normalized', 'show normalized N-Quads [false]')
    .option('    --validate', 'show simple hash validation [false]')
    .action(info)
    .on('--help', function() {
      console.log();
      console.log('  Displays information from a resource. The location can');
      console.log('  be stdin, a file, or a HTTP/HTTPS resource.');
      console.log();
      console.log('  By default the full resource and common PaySwarm types');
      console.log('  are processed unless explicit options are specified.');
      console.log();
      console.log('  The framed JSON-LD and hashes are output by default');
      console.log('  unless --framed, --hash, or --normalized are specified.');
      console.log();
      console.log('  The --validate option will show results of a simple');
      console.log('  check of hashes found at this resouce.');
      console.log();
      console.log('  Also see the jsonld tool from the jsonld.js project.');
      console.log();
    });
}

function info(loc, cmd) {
  // cache of hashes and data types for validation
  var cache = {
    hashes: {
      // id: hash
    },
    resources: {
      // type: [{}, ...]
    }
  };

  async.auto({
    config: function(callback) {
      common.config.read(cmd, callback);
    },
    data: ['config', function(callback, results) {
      cmd.base = cmd.base || '';
      cmd.context = cmd.context || null;

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
      cmd.validate = !!cmd.validate;
      // enable framed and hash display if none explicitly enabled
      if(!cmd.framed && !cmd.hash && !cmd.normalized) {
        cmd.framed = cmd.hash = true;
      }

      console.log('= Location');
      console.log('%s', loc || '[stdin]');
      common.request(cmd, loc, function(err, res, data) {
        if(err) {
          return callback(err);
        }
        callback(err, data);
      });
    }],
    raw: ['data', function(callback, results) {
      if(cmd.raw) {
        var ctx = payswarm.CONTEXT_URL;
        var opts = {
          base: cmd.base,
          expandContext: cmd.context
        };
        return jsonld.compact(results.data, ctx, opts,
          function(err, compacted) {
          console.log('\n= Raw');
          common.output(cmd, compacted, function(err) {
            if(err) {
              return callback(err);
            }
            callback(null);
          });
        });
      }
      callback(null);
    }],
    doc: ['data', 'raw', function(callback, results) {
      if(cmd.all || cmd.full) {
        return processOne(results.data, null, cache, cmd, callback);
      }
      callback(null);
    }],
    assets: ['data', 'doc', function(callback, results) {
      if(cmd.all || cmd.assets) {
        return processAll(results.data, 'Asset', cache, cmd, callback);
      }
      callback(null);
    }],
    licenses: ['data', 'assets', function(callback, results) {
      if(cmd.all || cmd.licenses) {
        return processAll(results.data, 'License', cache, cmd, callback);
      }
      callback(null);
    }],
    listings: ['data', 'licenses', function(callback, results) {
      if(cmd.all || cmd.listings) {
        return processAll(results.data, 'Listing', cache, cmd, callback);
      }
      callback(null);
    }],
    validate: ['data', 'listings', function(callback, results) {
      if(!cmd.validate) {
        return callback(null);
      }
      // simple hash validation
      // tri-state: valid, invalid, or unknown
      var valid = true;
      var invalid = false;
      console.log('\n= Validate');

      var check = function(listing, type, id, hash) {
        if(id in cache.hashes) {
          var cachedHash = cache.hashes[id];
          if(cachedHash !== hash) {
            console.log('== ERROR: %s hash mismatch!', type);
            console.log('=== Listing id: %s', listing.id);
            console.log('=== %s id: %s', type, id);
            console.log('=== Hash in listing: %s', hash);
            console.log('=== Computed hash: %s', cachedHash);
            invalid = true;
          }
        }
        else {
          console.log('== NOTE: %s hash not found.', type);
          console.log('=== %s: %s', type, id);
          valid = false;
        }
      };

      // check hashes in each listing
      var listings = cache.resources.Listing || [];
      listings.forEach(function(listing) {
        check(listing, 'Asset', listing.asset, listing.assetHash);
        check(listing, 'License', listing.license, listing.licenseHash);
      });

      // results
      var msg = 'YES';
      if(invalid) {
        msg = 'NO unless referenced data hashes are already available.';
      }
      else if(!valid) {
        msg = 'UNKNOWN because not all hashes were found. This may be OK.';
      }
      console.log('== valid: %s', msg);

      callback(null);
    }]
  }, function(err) {
    common.error(err);
  });
}

function processOne(data, type, cache, cmd, callback) {
  async.waterfall([
    function(callback) {
      if(type) {
        var r = cache.resources[type] || [];
        r.push(data);
        cache.resources[type] = r;
      }
      return payswarm.hash(data, function(err, hash) {
        if(err) {
          // FIXME: better handling of empty hash
          //return callback(err);
        }
        // record hash for id if possible
        if(data.id && hash) {
          cache.hashes[data.id] = hash;
        }
        callback(null, hash);
      });
    },
    function(hash, callback) {
      if(cmd.hash) {
        console.log('\n= Hash');
        if(type) {
          console.log('== type: %s', type);
          console.log('== id: %s', data.id || '[none]');
        }
        else {
          console.log('== id: %s', data.id || '[document]');
        }
        console.log('%s', hash || '[none]');
      }
      callback(null, data);
    },
    function(data, callback) {
      if(cmd.normalized) {
        var opts = {
          base: cmd.base,
          format: 'application/nquads'
        };
        return jsonld.normalize(data, opts, function(err, normalized) {
          if(err) {
            return callback(err);
          }
          console.log('\n= Normalized');
          console.log('== type: %s', type || '[none]');
          console.log('== id: %s', data.id || '[none]');
          console.log('%s', normalized.trim() || '[none]');
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

function processAll(data, type, cache, cmd, callback) {
  async.waterfall([
    function(callback) {
      if(!type) {
        return callback(new Error({
          message: 'No type given.',
          type: 'payswarm.InfoTool.InvalidType'
        }));
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
      var opts = {
        base: cmd.base
      };
      if(cmd.verbose) {
        console.log('\n= Frame');
        console.log('== type: %s', type);
        console.log('%s', JSON.stringify(frame, null, 2));
      }
      jsonld.frame(data, frame, opts, function(err, framed) {
        if(err) {
          return callback(err);
        }
        callback(null, framed);
      });
    },
    function(framed, callback) {
      var graphs = framed['@graph'];
      if(graphs.length === 0 && cmd.verbose) {
        console.log('\nNo objects of type \"%s\" found.', type);
        return callback(null);
      }
      async.eachSeries(graphs, function(graph, callback) {
        // use main context
        graph['@context'] = framed['@context'];
        if(cmd.framed) {
          console.log('\n= Framed');
          console.log('== type: %s', type || '[none]');
          console.log('== id: %s', graph.id || '[none]');
          console.log('%s', JSON.stringify(graph, null, 2));
        }
        processOne(graph, type, cache, cmd, callback);
      }, callback);
    }
  ], function(err) {
    if(err) {
      return callback(err);
    }
    callback(null);
  });
}

module.exports = {
  init: init
};

if(require.main === module) {
  common.error('Run this tool with the payswarm application.');
}
