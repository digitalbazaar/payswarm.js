/**
 * A helper library for reading and writing configuration files.
 *
 * @author Manu Sporny
 *
 * BSD 3-Clause License
 * Copyright (c) 2011-2012 Digital Bazaar, Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * Redistributions in binary form must reproduce the above copyright
 * notice, this list of conditions and the following disclaimer in the
 * documentation and/or other materials provided with the distribution.
 *
 * Neither the name of the Digital Bazaar, Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
 * IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
 * TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
 * PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var fs = require('fs');

var api = {};
module.exports = api;

/**
 * Reads configuration information from a file if the file exists, or just
 * returns an empty configuration object if it doesn't.
 *
 * @param cfgFilename the name of the config file.
 * @param callback the callback will be called with callback(err, config)
 */
api.readConfigFile = function(cfgFilename, callback) {
  var cfg = {};

  // add the default context to the object
  cfg['@context'] = 'https://w3id.org/payswarm/v1',

  // attempt to read data from the config file
  fs.readFile(cfgFilename, 'utf8', function(err, data) {
    if(err) {
      // ignore any error when attempting to read the file
    }
    else {
      console.log('Reading configuration from ' + cfgFilename);
      cfg = JSON.parse(data);
    }
    callback(null, cfg);
  });
};

/**
 * Writes a configuration out to disk.
 *
 * @param cfgFilename the name of the config file.
 * @param cfg the configuration object to write.
 * @param callback the callback will be called with callback(err)
 */
api.writeConfigFile = function(cfgFilename, cfg, callback) {
  var data = JSON.stringify(cfg, null, 2);
  fs.writeFile(cfgFilename, data, 'utf8', function(err) {
    if(err) {
      return callback(err);
    }
    console.log('Settings saved in '+ cfgFilename + '.');
    callback();
  });
};
