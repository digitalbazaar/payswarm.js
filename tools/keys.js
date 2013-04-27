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
var jsonld = require('./jsonld');
var util = require('util');
var payswarm = require('..');
var common = require('./common');

function init(options) {
  var cmd = options.program
    .command('keys [key]')
    .description('manage access keys');
  common
    .command
    .init(cmd)
    .option('    --id <id>', 'id to use [access key owner]')
    .option('-l, --list', 'list keys [true]')
    .option('-r, --register', 'register new key [false]')
    .action(keys);
}

function keys(key, cmd) {
  var single = (typeof key !== 'undefined');
  async.auto({
    config: function(callback) {
      common.command.config(cmd, callback);
    },
    init: ['config', function(callback, results) {
      cmd.list = !!cmd.list;
      cmd.register = !!cmd.register;

      var count = (single + cmd.list + cmd.register);
      if(count > 1) {
        return callback(new Error('Only one command at a time allowed.'));
      }

      // default to list
      if(count ===  0) {
        cmd.list = true;
      }

      // default id to key owner from config
      cmd.id = cmd.id || results.config.owner;

      // FIXME: allow short ids
      // FIXME: check cross authority id

      callback(null);
    }],
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
    }],
  }, function(err) {
    if(err) {
      common.error(cmd, err);
    }
  });
}

function list(cmd, key, callback) {
  // FIXME: make into common short id helper
  // all keys by default
  var url = cmd.id + '/keys';
  if(key !== null) {
    // check for full key
    if(key.indexOf('http://') === 0 || key.indexOf('https://') === 0) {
      url = key;
    }
    // else a short id
    else {
      url = url + '/' + key;
    }
  }

  common.request(cmd, url, function(err, res, result) {
    if(err) {
      return callback(err);
    }
    common.output(cmd, result, callback);
  })
}

function register(cmd, callback) {
  callback(new Error('Register not implemented yet.'));
}

module.exports = {
  init: init
};

if(require.main === module) {
  common.error('Run this tool with the payswarm application.');
}
