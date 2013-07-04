/**
 * PaySwarm common tool support.
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
var fs = require('fs');
var jsonld = require('./jsonld');
var payswarm = require('..');
var pkginfo = require('pkginfo')(module, 'version');
var program = require('commander');

var DEFAULT_CONFIG =
  process.env.PAYSWARM_CONFIG ||
  'payswarm.cfg';

var DEFAULT_AUTHORITY =
  process.env.PAYSWARM_AUTHORITY ||
  'https://dev.payswarm.com/';

/**
 * Create a PaySwarm tool.
 *
 * @param options options for the tool
 *          init: function(options) called to initialize the tool
 *            options:
 *              program: the commander.js program
 * @return a commander.js command
 */
function tool(options) {
  // setup defaults
  options = options || {};
  if(!options.run) {
    options.run = true;
  }

  // initialize program
  program
    .version(module.exports.version);

  if(options.init) {
    options.init({
      program: program
    });
  }

  // run program if top-level
  if(options.topLevel) {
    var argv = options.argv || process.argv;
    program.parse(argv);
  }

  return program;
}

/**
 * Initialize a command.js command with default options.
 *
 * @param cmd a commander.js command
 * @return a commander.js command
 */
function init(cmd) {
  cmd
    .option('-c, --config <config>',
      'config file to load [' + DEFAULT_CONFIG + ']')
    .option('-a, --authority <authority>',
      'PaySwarm Authority to use [' + DEFAULT_AUTHORITY + ']')
    .option('-v, --verbose', 'verbose output [false]')
    .option('-q, --quiet', 'quieter output [false]')
    .option('-y, --yes', 'always confirm with \'yes\' [false]')
    .option('-i, --indent <spaces>', 'spaces to indent [2]', Number, 2)
    .option('-N, --no-newline', 'do not output the trailing newline [newline]')
    .option('-k, --insecure', 'allow insecure SSL connections [false]')
    .on('--help', function() {
      console.log();
      console.log(
'  Config file precedence: --config option, PAYSWARM_CONFIG environment\n' +
'  variable, or the default config.');
      console.log();
      console.log(
'  Authority URL precedence: --authority option, config file property,\n' +
'  PAYSWARM_AUTHORITY environment variable, or the default authority.');
      console.log();
    });
  return cmd;
}

/**
 * Read a config.
 *
 * @param cmd a commander.js command
 * @param options read options (optional):
 *          strict: config must exist [true if file given, false if default]
 * @param callback function(err, config) called when done with any error or a
 *          config
 */
function readConfig(cmd, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  if(!('strict' in options)) {
    options.strict = !!cmd.config;
  }

  cmd.config = cmd.config || DEFAULT_CONFIG;
  cmd.verbose = !!cmd.verbose;
  cmd.quiet = !!cmd.quiet;
  cmd.yes = !!cmd.yes;
  cmd.insecure = !!cmd.insecure;

  async.waterfall([
    function(callback) {
      request(cmd, cmd.config, function(err, res, cfg) {
        if(err) {
          if(err.code && err.code === 'ENOENT' && !options.strict) {
            err = null;
            cfg = {
              '@context': payswarm.CONTEXT_URL
            };
          }
        }
        callback(err, res, cfg);
      });
    },
    function(res, cfg, callback) {
      cfg.authority = cmd.authority || cfg.authority || DEFAULT_AUTHORITY;
      callback(null, cfg);
    }
  ], function(err, cfg) {
    if(err) {
      return callback(err);
    }
    if(cmd.verbose) {
      console.log('I: config=' + JSON.stringify(cfg, null, cmd.indent));
    }
    callback(null, cfg);
  });
}

/**
 * Write a config.
 *
 * @param cmd a commander.js command
 * @param config the config to write
 * @param loc the location to write to
 * @param options write options (optional):
 *          overwrite: overwrite an existing file [false]
 * @param callback function(err, config) called when done with any error or a
 *          config
 */
function writeConfig(cmd, cfg, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options.overwrite = !!options.overwrite;

  async.waterfall([
    function(callback) {
      if(!options.overwrite) {
        return fs.exists(cmd.config, function(exists) {
          if(exists) {
            return callback(new Error('Config exists: ' + cmd.config));
          }
          callback(null);
        });
      }
      callback(null);
    },
    function(callback) {
      fs.writeFile(cmd.config, JSON.stringify(cfg, null, 2), callback);
    }
  ], function(err) {
    if(err) {
      return callback(err);
    }
    if(cmd.verbose) {
      console.log('I: writeConfig file=' + cmd.config);
    }
    callback(null);
  });
}

/**
 * Build a request options object.
 *
 * @param cmd a commander.js command
 * @param options default options. (optional)
 *
 * @return options for a request
 */
function requestOptions(cmd, options) {
  options = options || {};

  if(!('strictSSL' in options)) {
    options.strictSSL = !cmd.insecure;
  }

  // FIXME: document followRedirct option
  options.followRedirect = !!options.followRedirect;

  // FIXME: add noAuth option to skip this
  // if using http signature, add default headers if none specified
  if(options.httpSignature && !options.httpSignature.headers) {
    options.httpSignature = options.httpSignature || {};
    options.httpSignature.headers = ['request-line', 'host', 'date'];
  }

  return options;
}


/**
 * Wrapper for jsonld.request that handles common options.
 *
 * @param cmd a commander.js command
 * @param loc the URL to use
 * @param options options for jsonld.request (optional)
 * @param callback function(err, res, result) called when done with any error,
 *          the response object, and the result
 */
function request(cmd, loc, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  options = requestOptions(cmd, options);

  // FIXME: use payswarm.get/postJsonLd instead
  jsonld.request(loc, options, callback);
}

/**
 * Make an ID from a given input.
 *
 * This function can build an ID out of:
 *   falsy: use base ID
 *   url: use explicit URL
 *   short ID: add short ID onto base ID
 *
 * @param base a base ID used as a default or prefix for short ID input
 * @param input the input full or short ID or falsy value
 *
 * @return the new ID
 */
function makeId(base, input) {
  // check if not falsy
  if(input) {
    // check for full id
    if(input.indexOf('http://') === 0 || input.indexOf('https://') === 0) {
      return input;
    }
    // else a short id
    else {
      return base + '/' + input;
    }
  }

  return base;
}

/**
 * Parse the string or value and return a boolean value or raise an exception.
 * Handles true and false booleans and case-insensitive 'yes', 'no', 'true',
 * 'false', 't', 'f', '0', '1' strings.
 *
 * @param value a string of value.
 * @return the boolean conversion of the value.
 */
function boolify(value) {
  if(typeof value === 'boolean') {
    return value;
  }
  if(typeof value === 'string' && value) {
    var lower = value.toLowerCase();
    switch(value.toLowerCase()) {
      case 'true':
      case 't':
      case '1':
      case 'yes':
      case 'y':
        return true;
      case 'false':
      case 'f':
      case '0':
      case 'no':
      case 'n':
        return false;
    }
  }
  // if here we couldn't parse it
  throw new Error('Invalid boolean:' + value);
}

/**
 * Print an object using common options.
 *
 * @param cmd a commander.js command
 * @param data the object
 * @param callback function(err) called when done with any error
 */
function output(cmd, data, callback) {
  process.stdout.write(JSON.stringify(data, null, cmd.indent));
  if(cmd.newline) {
    process.stdout.write('\n');
  }
  callback(null);
}

/**
 * If an error given, print it and exit, else no action.
 *
 * @param err the error to print or null
 */
function error(err) {
  if(!err) {
    return;
  }
  var prefix = 'Error:';
  if(err instanceof Error) {
    console.error(prefix, JSON.stringify(err, null, 2));
    if(err.stack) {
      console.error(prefix, err.stack);
    }
  }
  else if(typeof err === 'object') {
    console.error(prefix, JSON.stringify(err, null, 2));
  }
  else {
    console.error(prefix, err);
  }
  process.exit(1);
}

module.exports = {
  tool: tool,
  command: {
    init: init
  },
  config: {
    read: readConfig,
    write: writeConfig
  },
  requestOptions: requestOptions,
  request: request,
  makeId: makeId,
  boolify: boolify,
  output: output,
  error: error
};

if(require.main === module) {
  error('This is a library for use with other tools.');
}
