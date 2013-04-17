#!/usr/bin/env node
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
    .option('-k, --insecure', 'allow insecure SSL connections [false]');
  return cmd;
};

/**
 * Load a config.
 *
 * @param cmd a commander.js command
 * @param callback function(err, config) called when done with any error or a
 *          config
 */
function config(cmd, callback) {
  var cfgloc = cmd.config || DEFAULT_CONFIG;

  cmd.verbose = !!cmd.verbose;
  cmd.quiet = !!cmd.quiet;
  cmd.yes = !!cmd.yes;
  cmd.insecure = !!cmd.insecure;

  async.waterfall([
    function(callback) {
      request(cmd, cfgloc, callback);
    },
    function(res, cfg, callback) {
      cfg.authority = cmd.authority || DEFAULT_AUTHORITY;
      callback(null, cfg);
    }
  ], function(err, cfg) {
    if(cmd.verbose) {
      console.log('I: config=' + JSON.stringify(cfg, null, cmd.indent));
    }
    callback(null, cfg);
  });
}

/**
 * Wrapper for jsonld.request that handles common options.
 *
 * @param cmd a commander.js command
 * @param loc the URL to use
 * @param options options for jsonld.request
 * @param callback function(err, res, result) called when done with any error,
 *          the response object, and the result
 */
function request(cmd, loc, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  if(!('strictSSL' in options)) {
    options.strictSSL = !cmd.insecure;
  }

  // FIXME: add an option to follow redirects
  options.followRedirect = false;

  // add default headers if none specified
  if(!options.httpSignature || !options.httpSignature.headers) {
    options.httpSignature = options.httpSignature || {};
    options.httpSignature.headers = ['request-line', 'host', 'date'];
  }
  // FIXME: use payswarm.get/postJsonLd instead?
  jsonld.request(loc, options, callback);
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
 * Print an error and exit.
 *
 * @param cmd a commander.js command
 * @param err the error to print
 * @param callback function(err) called when done with any error
 */
function error(cmd, err) {
  if(err instanceof Error) {
    console.error('E:', JSON.stringify(err, null, 2));
    if(err.stack) {
      console.error('E:', err.stack);
    }
  }
  else if(typeof err === 'object') {
    console.error('E:', JSON.stringify(err, null, 2));
  }
  else {
    console.error('E:', err);
  }
  process.exit(1);
}

module.exports = {
  tool: tool,
  command: {
    init: init,
    config: config
  },
  request: request,
  output: output,
  error: error
};

if(require.main === module) {
  console.error('Error: This is a library for use with other tools.');
  process.exit(1);
}
