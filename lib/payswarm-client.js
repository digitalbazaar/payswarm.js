/**
 * A JavaScript implementation of the PaySwarm API.
 *
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

'use strict';

var async = require('async');
var crypto = require('crypto');
var fs = require('fs');
var jsonld = require('jsonld')(); // get localized jsonld API
var mkdirp = require('mkdirp');
var path = require('path');
var URL = require('url');
var ursa = require('ursa');
var util = require('util');

jsonld.use('request');

var api = {};
module.exports = api;

/*

PAYSWARM CLIENT API
-------------------

The PaySwarm Client API allows vendors to register with a PaySwarm Payment
Processor, sign listings for the items they wish to sell, and receive payments
from their customers.

INSTRUCTIONS
------------

Use the API to register as a vendor on the PaySwarm Payment Processor of
choice, sign listings, and accept payments via customers' chosen PaySwarm
Payment Processors.

First, require this module:

var payswarm = require('payswarm');

Then:

1. Get the identity of PaySwarm Payment Processors that should be trusted:

  payswarm.getPaymentProcessorIdentity('payment-processor:port');

  In this version of the API, any customer's PaySwarm Payment Processor that
  the vendor would like to do business with must be manually tracked, including
  the vendor's own processor. The identities for any trusted processors should
  be stored and checked when receiving messages, such as digital receipts,
  from those processors.

2. Register as a vendor by calling:

  var url = payswarm.getRegisterVendorUrl({
    host: 'my-payment-processor:port',
    callback: 'http://my-server.com/my-register-callback-url',
    publicKey: '-----BEGIN PUBLIC KEY-----...',
    nonce: 'a-custom-generated-nonce'
  }, callback);

  The parameters include the host and port of the PaySwarm Payment Processor to
  register with, the callback URL that will receive the result of the
  registration as POST data, the public key to register to be used to
  encrypt messages, and a nonce to be used in the encrypted response.

  Direct the vendor to the URL so that they can complete the registration
  process. Once the registration process is complete, the vendor's browser
  will POST the registration result to the callback URL provided.

3. On the callback page, get the POST value 'encrypted-message' and pass it
  to register the vendor:

  payswarm.registerVendor(req.body['encrypted-message'], {
    key: '-----BEGIN PRIVATE KEY-----',
    verify: {
      checkNonce: function(nonce, options, callback) {
        // TODO: check nonce is 'a-custom-generated-nonce' and isn't reused
        callback(null, true);
      },
      checkDomain: function(domain, options, callback) {
        // TODO: check domain is my-server.com
        callback(null, true);
      },
      checkKeyOwner: function(owner, key, options, callback) {
        // TODO: check owner is result of payswarm.getPaymentProcessorIdentity
        callback(null, true);
      }
    }
  }, callback);

  If no error is given to the callback, registration is complete. The second
  callback parameter is the PaySwarm Vendor's Preferences, including the
  Financial Account ID to use in Listings.

5. Create a JSON-LD PaySwarm Asset and Listing. When listing an Asset, its
  unique hash must be in the Listing. To generate an asset hash call:

  payswarm.hash(asset, callback);

4. Sign a listing. Create a JSON-LD PaySwarm Listing and then sign it:

  payswarm.sign(listing, callback);

  Display the listing information and ensure it can be obtained as
  JSON-LD (application/ld+json). Depending on the application's needs, it is
  sometimes a good idea (or a requirement) to regenerate signatures on
  a periodic basis or when the vendor's public key is changed.

5. When a customer indicates that they want to purchase the Asset in a
  Listing, call:

  var url = payswarm.getPurchaseUrl({
    host: 'customers-payment-processor:port',
    listingId: 'http://my-server.com/listings/1234',
    listingHash: 'urn:sha-256:abe732bf3bdebc636cb3a6e3f...',
    callback: 'http://my-server.com/my-purchase-callback-url'
  }, callback);

  To get a URL to redirect the customer to their PaySwarm Payment Processor to
  complete the purchase. The last parameter is a callback URL that will
  receive the result of the purchase as POST data.

  If the customer has previously completed a purchase and the response
  indicated that they set up a budget to handle automated purchases in the
  future, then an automated purchase can be attempted by calling:

  payswarm.purchase({
    host: 'customers-payment-processor:port',
    identity: 'https://customers-payment-processor:port/i/customer',
    listing: 'http://my-server.com/listings/1234',
    listingHash: 'urn:sha-256:abe732bf3bdebc636cb3a6e3f...'
  }, callback);

  In this version of the API, it is the responsibility of the application to
  determine the customer's PaySwarm Payment Processor (eg: by asking them
  to enter it into a Website form). A listing hash can be generated by calling:

  payswarm.hash(listing, callback);

  To get the JSON-LD receipt from a purchase, call:

  payswarm.getReceipt(encryptedMessage, {
    key: '-----BEGIN PRIVATE KEY-----...',
    verify: {
      checkNonce: function(nonce, options, callback) {
        // TODO: check nonce is 'a-custom-generated-nonce' and isn't reused
        callback(null, true);
      },
      checkDomain: function(domain, options, callback) {
        // TODO: check domain is my-server.com
        callback(null, true);
      },
      checkKeyOwner: function(owner, key, options, callback) {
        // TODO: check owner is result of payswarm.getPaymentProcessorIdentity
        callback(null, true);
      }
    }
  }, callback);

  Where encryptedMessage is either the result of a POST to the purchase
  callback or the result of the payswarm.purchase() call.

  The receipt will indicate the ID and hash of the Asset purchased as well
  as the ID and hash of the License for the Asset.

*/

/**
 * Versioned PaySwarm JSON-LD context URLs.
 */
api.CONTEXT_V1_URL = "https://w3id.org/payswarm/v1";

/**
 * Default PaySwarm JSON-LD context URL.
 */
api.CONTEXT_URL = api.CONTEXT_V1_URL;

/**
 * Supported PaySwarm JSON-LD contexts.
 */
api.CONTEXTS = {};

/**
 * V1 PaySwarm JSON-LD context.
 */
api.CONTEXTS[api.CONTEXT_V1_URL] = JSON.parse(
  fs.readFileSync('../contexts/payswarm-v1.jsonld', 'utf8'));

/**
 * Default PaySwarm JSON-LD context.
 */
api.CONTEXT = api.CONTEXTS[api.CONTEXT_URL];

/**
 * PaySwarm JSON-LD frames.
 */
api.FRAMES = {};

/** PaySwarm JSON-LD frame for an Asset. */
api.FRAMES.Asset = {
  '@context': api.CONTEXT_URL,
  type: 'Asset',
  creator: {},
  signature: {'@embed': true},
  assetProvider: {'@embed': false}
};

/** PaySwarm JSON-LD frame for a License. */
api.FRAMES.License = {
  '@context': api.CONTEXT_URL,
  type: 'License'
};

/** PaySwarm JSON-LD frame for a Listing. */
api.FRAMES.Listing = {
  '@context': api.CONTEXT_URL,
  type: 'Listing',
  asset: {'@embed': false},
  license: {'@embed': false},
  vendor: {'@embed': false},
  signature: {'@embed': true}
};

/**
 * Determines the configuration filename based on the given name and
 * PaySwarm-specific defaults. This method will always return a filename.
 *
 * @param configName the name of the config file, which can be null
 *          (the default config), a pathname, or a nickname for a
 *          previously saved configuration file.
 * @param callback(err, filename) called when the config has been read.
 */
api.getConfigFilename = function(configName, callback) {
  if(configName) {
    // TODO: check if it's a dir (not a file) and error out early?
    // if configName is an absolute path use it
    var normalized = path.normalize(configName);
    if(path.resolve(normalized) === normalized) {
      return callback(null, configName);
    }
  }

  // establish base config directory
  var baseConfigDir = path.resolve(process.env.HOME);
  if(process.env.XDG_CONFIG_HOME) {
    baseConfigDir = path.resolve(process.env.XDG_CONFIG_HOME);
  }

  // if a config name was not given, use the default
  if(!configName) {
    var configFilename = path.join(
      baseConfigDir, '.config', 'payswarm1', 'default');
    return callback(null, configFilename);
  }

  // if a valid relative file name was given, use that
  var relativeFile = path.resolve(configName);
  fs.exists(relativeFile, function(exists) {
    if(exists) {
      return callback(null, relativeFile);
    }
    // if a config name was given, use that
    var configFilename = path.join(
      baseConfigDir, '.config', 'payswarm1', configName);
    callback(null, configFilename);
  });
};

/**
 * Reads configuration information from a file if the file exists, or just
 * returns an empty configuration object if it doesn't.
 *
 * @param configName the name of the config file, which can be a pathname
 *          or a nickname for a saved configuration file.
 * @param callback(err, config) called when the config has been read.
 */
api.readConfig = function(configName, callback) {
  async.async({
    getFilename: function(callback) {
      api.getConfigFilename(configName, callback);
    },
    read: ['getFilename', function(callback, results) {
      // attempt to read data from the config file
      var filename = results.getFilename;
      fs.exists(filename, function(exists) {
        if(exists) {
          return fs.readFile(filename, 'utf8', callback);
        }
        callback(new Error('Config file does not exist: ' + filename));
      });
    }],
    parse: ['read', function(callback, results) {
      var config;
      try {
        config = JSON.parse(results.readFile);
      } catch(e) {
        return callback(new Error('Config file parse error: ' + e));
      }
      // add default context to config
      config['@context'] = 'https://w3id.org/payswarm/v1';
      callback(null, config);
    }]
  }, function(err, results) {
    callback(err, err ? null : results.parse);
  });
};

/**
 * Writes a configuration out to disk.
 *
 * @param configName the name of the config file.
 * @param config the configuration object to write.
 * @param callback(err, configFilename) the callback called when the file is
 *          written to disk.
 */
api.writeConfig = function(configName, config, callback) {
  async.auto({
    getFilename: function(callback) {
      api.getConfigFilename(configName, callback);
    },
    mkdir: ['getFilename', function(callback, results) {
      var filename = results.getFilename;
      var dir = path.dirname(filename);
      // if the directory for the config file doesn't exist, create it
      fs.exists(dir, function(exists) {
        if(exists) {
          return callback(null, filename);
        }
        mkdirp(dir, parseInt(700, 8), function(err) {
          if(err) {
            return callback(err);
          }
          callback(null, filename);
        });
      });
    }],
    write: ['mkdir', function(callback, results) {
      // write the data to disk
      var json = JSON.stringify(config, null, 2);
      fs.writeFile(
        results.getFilename, json, {encoding: 'utf8', mode: parseInt(600, 8)},
        function(err) {
        if(err) {
          return callback(err);
        }
        callback(null, results.getFilename);
      });
    }]
  }, function(err, results) {
    callback(err, err ? null : results.write);
  });
};

/**
 * Retrieves a JSON-LD object over HTTP. To implement caching, override
 * this method.
 *
 * @param url the URL to HTTP GET.
 * @param [options] the options to pass to the underlying document loader;
 *          see jsonld.documentLoaders.node for details.
 * @param callback(err, result) called once the operation completes.
 */
api.getJsonLd = function(url, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  var documentLoader = jsonld.documentLoaders.node(options);
  documentLoader(url, function(err, result) {
    if(err) {
      return callback(err);
    }
    // ensure result is parsed
    if(typeof result.document === 'string') {
      try {
        result.document = JSON.parse(result.document);
      } catch(e) {
        return callback(e);
      }
    }
    if(!result.document) {
      return callback(new Error(
        '[payswarm.getJsonLd] No JSON-LD found at "' + url + '".'));
    }
    // compact w/context URL from link header
    if(result.contextUrl) {
      return jsonld.compact(
        result.document, result.contextUrl, {expandContext: result.contextUrl},
        callback);
    }
    callback(null, result.document);
  });
};

/**
 * HTTP POSTs a JSON-LD object.
 *
 * @param url the URL to HTTP POST to.
 * @param obj the JSON-LD object.
 * @param [options] the options to use.
 *          [request] mutable options to pass to the underlying request lib.
 * @param callback(err, result) called once the operation completes.
 */
api.postJsonLd = function(url, obj, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  // setup options
  var opts = {};
  for(var key in options) {
    opts[key] = options;
  }
  opts.headers = {};
  if(options.headers) {
    for(var header in options.headers) {
      opts.headers[header] = options.headers;
    }
  }
  opts.method = 'POST';
  opts.headers['Content-Type'] = 'application/ld+json';
  opts.body = JSON.stringify(obj);

  jsonld.request(url, options, function(err, res, data) {
    if(err) {
      return callback(err);
    }
    try {
      // parse response
      data = JSON.parse(data);
    }
    catch(ex) {
      return callback(new Error('[payswarm.postJsonLd] ' +
        'Invalid response from "' + url +
        '"; malformed JSON - ' + ex.toString() + ': ' + data));
    }
    callback(err, data);
  });
};

/**
 * Gets a remote public key.
 *
 * @param id the ID for the public key.
 * @param [options] the options to use.
 *          [request] any options to pass to payswarm.getJsonLd.
 * @param callback(err, key) called once the operation completes.
 */
api.getPublicKey = function(id, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  api.getJsonLd(id, options.request, function(err, key) {
    if(err) {
      return callback(err);
    }

    // FIXME: improve validation
    if(!('publicKeyPem' in key)) {
      return callback(new Error('[payswarm.getPublicKey] ' +
        'Could not get public key. Unknown format.'));
    }

    callback(null, key);
  });
};

/**
 * Generates a hash of the JSON-LD encoded data.
 *
 * @param obj the JSON-LD object to hash.
 * @param callback(err, hash) called once the operation completes.
 */
api.hash = function(obj, callback) {
  // hash normalized RDF
  jsonld.normalize(obj, {format: 'application/nquads'}, function(err, result) {
    if(err) {
      return callback(err);
    }
    if(result.length === 0) {
      return callback(new Error('[payswarm.hash] ' +
        'The data to hash is empty. This error may be caused because ' +
        'a "@context" was not supplied in the input which would cause ' +
        'any terms or prefixes to be undefined. ' +
        'Input:\n' + JSON.stringify(obj, null, 2)));
    }
    var md = crypto.createHash('sha256');
    md.update(result, 'utf8');
    callback(null, 'urn:sha256:' + md.digest('hex'));
  });
};

/**
 * Signs a JSON-LD object, adding a signature field to it. If a signature
 * date is not provided then the current date will be used.
 *
 * @param obj the JSON-LD object to sign.
 * @param options the signature options.
 *          key the PEM-formatted private key to use.
 *          keyId ID (URL) of the public key associated with the private key.
 *          [date] the W3C formatted dateTime or a JavaScript Date object.
 *          [domain] a domain to restrict the signature to.
 *          [nonce] a nonce to use.
 * @param callback(err, signed) called once the operation completes.
 */
api.sign = function(obj, options, callback) {
  if(typeof options.key !== 'string') {
    throw new TypeError('options.key must be a PEM formatted string.');
  }
  if(typeof options.keyId !== 'string') {
    throw new TypeError('options.keyId must be a string.');
  }

  var key = options.key;
  var keyId = options.keyId;
  var date = options.date || new Date();
  var domain = options.domain || null;
  var nonce = options.nonce || null;

  // get W3C-formatted date
  if(typeof date !== 'string') {
    date = api.w3cDate(date);
  }

  async.auto({
    normalize: function(callback) {
      jsonld.normalize(obj, {format: 'application/nquads'}, callback);
    },
    sign: ['normalize', function(callback, results) {
      var normalized = results.normalize;
      if(normalized.length === 0) {
        return callback(new Error('[payswarm.sign] ' +
          'The data to sign is empty. This error may be caused because ' +
          'a "@context" was not supplied in the input which would cause ' +
          'any terms or prefixes to be undefined. ' +
          'Input:\n' + JSON.stringify(obj, null, 2)));
      }
      // generate base64-encoded signature
      var signer = crypto.createSign('RSA-SHA256');
      if(nonce !== null) {
        signer.update(nonce);
      }
      signer.update(date);
      signer.update(normalized);
      if(domain !== null) {
        signer.update('@' + domain);
      }
      var signature = signer.sign(key, 'base64');
      callback(null, signature);
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }

    // create signature info
    var signature = {
      type: 'GraphSignature2012',
      creator: keyId,
      created: date,
      signatureValue: results.sign
    };
    if(domain !== null) {
      signature.domain = domain;
    }
    if(nonce !== null) {
      signature.nonce = nonce;
    }
    // TODO: support multiple signatures
    obj.signature = signature;
    jsonld.addValue(obj, '@context', api.CONTEXT_URL, {allowDuplicate: false});
    callback(null, obj);
  });
};

/**
 * Verifies a JSON-LD digitally-signed object.
 *
 * @param obj the JSON-LD object to verify.
 * @param [options] the options to use.
 *          [checkNonce(nonce, options, function(err, valid))] a callback to
 *            check if the nonce (null if none) used in the signature is valid.
 *          [checkDomain(domain, options, function(err, valid))] a callback
 *            to check if the domain used (null if none) is valid.
 *          [checkKey(key, options, function(err, trusted))] a callback to
 *            check if the key used to sign the message is trusted.
 *          [checkKeyOwner(owner, key, options, function(err, trusted))] a
 *            callback to check if the key's owner is trusted.
 *          [checkTimestamp]: check signature timestamp (default: true).
 *          [maxTimestampDelta]: signature must be created within a window of
 *            this many seconds (default: 15 minutes).
 * @param callback(err) called once the operation completes.
 */
api.verify = function(obj, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  var checkTimestamp = (
    'checkTimestamp' in options ? options.checkTimestamp : true);
  var maxTimestampDelta = (
    'maxTimestampDelta' in options ? options.maxTimestampDelta : (15 * 60));

  async.auto({
    // FIXME: add support for multiple signatures
    //      : for many signers of an object, can just check all sigs
    //      : for signed sigs, need to recurse?
    // FIXME: add support for different signature types
    //      : frame with signatures to get types, then reframe to get
    //      : correct structure for each type.
    frame: function(callback) {
      // frame message to retrieve signature
      var frame = {
        '@context': api.CONTEXT_URL,
        signature: {
          type: 'GraphSignature2012',
          created: {},
          creator: {},
          domain: {},
          nonce: {},
          // FIXME: improve handling signatures w/o nonces
          //nonce: {'@omitDefault': true}
          signatureValue: {}
        }
      };
      jsonld.frame(obj, frame, function(err, framed) {
        if(err) {
          return callback(err);
        }
        var graphs = framed['@graph'];
        if(graphs.length === 0) {
          return callback(new Error('[payswarm.verify] ' +
            'No signed data found.'));
        }
        if(graphs.length > 1) {
          return callback(new Error('[payswarm.verify] ' +
            'More than one signed graph found.'));
        }
        var graph = graphs[0];
        // copy the top level framed data context
        graph['@context'] = framed['@context'];
        var signature = graph.signature;
        if(!signature) {
          return callback(new Error('[payswarm.verify] ' +
            'The message is not digitally signed using a known algorithm.'));
        }
        callback(null, graph);
      });
    },
    checkNonce: ['frame', function(callback, results) {
      var signature = results.frame.signature;
      var cb = function(err, valid) {
        if(err) {
          return callback(err);
        }
        if(!valid) {
          return callback(new Error('[payswarm.verify] ' +
            'The message nonce is invalid.'));
        }
        callback();
      };
      if(!options.checkNonce) {
        return cb(null, (signature.nonce === null));
      }
      options.checkNonce(signature.nonce, options, cb);
    }],
    checkDomain: ['frame', function(callback, results) {
      var signature = results.frame.signature;
      var cb = function(err, valid) {
        if(err) {
          return callback(err);
        }
        if(!valid) {
          return callback(new Error('[payswarm.verify] ' +
            'The message domain is invalid.'));
        }
        callback();
      };
      if(!options.checkDomain) {
        return cb(null, (signature.domain === null));
      }
      options.checkDomain(signature.domain, options, cb);
    }],
    checkDate: ['frame', function(callback, results) {
      if(!checkTimestamp) {
        return callback();
      }

      // ensure signature timestamp within a valid range
      var now = Date.now();
      var delta = maxTimestampDelta * 1000;
      try {
        var signature = results.frame.signature;
        var created = Date.parse(signature.created).getTime();
        if(created < (now - delta) || created > (now + delta)) {
          throw new Error('[payswarm.verify] ' +
            'The message digital signature timestamp is out of range.');
        }
      } catch(ex) {
        return callback(ex);
      }
      callback();
    }],
    getPublicKey: ['frame', function(callback, results) {
      var signature = results.frame.signature;
      api.getPublicKey(signature.creator, options, callback);
    }],
    checkKey: ['getPublicKey', function(callback, results) {
      if('revoked' in results.getPublicKey) {
        return callback(new Error('[payswarm.verify] ' +
          'The message was signed with a key that has been revoked.'));
      }
      var cb = function(err, trusted) {
        if(err) {
          return callback(err);
        }
        if(!trusted) {
          throw new Error('[payswarm.verify] ' +
            'The message was not signed with a trusted key.');
        }
        callback();
      };
      if(options.checkKey) {
        return options.checkKey(results.getPublicKey, options, cb);
      }
      api.checkKey(results.getPublicKey, options, cb);
    }],
    normalize: ['checkNonce', 'checkDate', 'checkKey',
      function(callback, results) {
      // remove signature property from object
      var result = results.frame;
      var signature = result.signature;
      delete result.signature;

      jsonld.normalize(
        result, {format: 'application/nquads'}, function(err, normalized) {
        if(err) {
          return callback(err);
        }
        callback(null, {data: normalized, signature: signature});
      });
    }],
    verifySignature: ['normalize', function(callback, results) {
      var key = results.getPublicKey;
      var signature = results.normalize.signature;

      var verifier = crypto.createVerify('RSA-SHA256');
      if(signature.nonce !== null) {
        verifier.update(signature.nonce);
      }
      verifier.update(signature.created);
      verifier.update(results.normalize.data);
      if(signature.domain !== null) {
        verifier.update(signature.domain);
      }
      var verified = verifier.verify(
        key.publicKeyPem, signature.signatureValue, 'base64');
      if(!verified) {
        return callback(new Error('[payswarm.verify] ' +
          'The digital signature on the message is invalid.'));
      }
      callback();
    }]
  }, callback);
};

/**
 * Checks to see if the given key is trusted.
 *
 * @param key the public key to check.
 * @param [options] the options to use.
 *          [checkKeyOwner(owner, key)] a custom method to return whether
 *            or not the key owner is trusted.
 *          [request] any options to pass to payswarm.getJsonLd.
 * @param callback(err, trusted) called once the operation completes.
 */
api.checkKey = function(key, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  async.auto({
    getOwner: function(callback) {
      api.getJsonLd(key.owner, options.request, callback);
    },
    frameOwner: ['getOwner', function(callback, results) {
      var frame = {
        '@context': api.CONTEXT_URL,
        publicKey: {'@embed': false}
      };
      jsonld.frame(results.getOwner, frame, function(err, framed) {
        if(err) {
          return callback(err);
        }
        callback(null, framed['@graph']);
      });
    }],
    checkOwner: ['frameOwner', function(callback, results) {
      // find specific owner of key
      var owner;
      var owners = results.frameOwner;
      for(var i = 0; i < owners; ++i) {
        if(jsonld.hasValue(owners[i], 'publicKey', key.id)) {
          owner = owners[i];
          break;
        }
      }
      if(!owner) {
        return callback(new Error('[payswarm.verify] ' +
          'The public key is not owned by its declared owner.'));
      }
      if(!options.checkKeyOwner) {
        return callback();
      }
      options.checkKeyOwner(owner, key, options, function(err, trusted) {
        if(err) {
          return callback(err);
        }
        if(!trusted) {
          return callback(new Error('[payswarm.verify] ' +
            'The owner of the public key is not trusted.'));
        }
      });
    }]
  }, function(err) {
    callback(err, !err && true);
  });
};

/**
 * Decrypts an encrypted, digitally-signed JSON-LD message.
 *
 * See: Secure Messaging 1.0.
 * https://web-payments.org/specs/source/secure-messaging/
 *
 * @param encrypted the message to decrypt.
 * @param key the PEM-formatted private key to decrypt the message.
 * @param [options] the options to use.
 *          [verify] any options to pass to payswarm.verify.
 * @param callback(err, decrypted) called once the operation completes.
 */
api.decrypt = function(encrypted, key, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  if(typeof key !== 'string') {
    throw new TypeError('key must be a PEM-formatted string.');
  }

  // JSON parse if necessary
  if(typeof encrypted === 'string') {
    try {
      encrypted = JSON.parse(encrypted);
    } catch(ex) {
      return callback(new Error('[payswarm.decrypt] ' +
        'Failed to decrypt the encrypted message: ' + ex.toString()));
    }
  }

  if(encrypted.cipherAlgorithm !== 'rsa-sha256-aes-128-cbc') {
    var algorithm = encrypted.cipherAlgorithm;
    return callback(new Error('[payswarm.decrypt] ' +
      'Unknown encryption algorithm "' + algorithm + '"'));
  }

  var msg;
  try {
    // RSA decrypt key and IV
    var pkey = ursa.createPrivateKey(key, 'utf8');
    var encryptionKey = pkey.decrypt(
      encrypted.cipherKey, 'base64', 'binary',
      ursa.RSA_PKCS1_OAEP_PADDING);
    var iv = pkey.decrypt(
      encrypted.initializationVector, 'base64', 'binary',
      ursa.RSA_PKCS1_OAEP_PADDING);

    // symmetric decrypt data
    var decipher = crypto.createDecipheriv('aes-128-cbc', encryptionKey, iv);
    var decrypted = decipher.update(encrypted.cipherData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    // parse message
    msg = JSON.parse(decrypted);
  } catch(ex) {
    return callback(new Error('[payswarm.decrypt] ' +
      'Failed to decrypt the encrypted message: ' + ex.toString()));
  }

  // verify message
  api.verify(msg, options.verify, function(err) {
    callback(err, msg);
  });
};

/**
 * Gets the well-known config for a service.
 *
 * @param host the service host and port.
 * @param [options] the options to use.
 *          [service] the service to use (default: 'payswarm').
 *          [request] any options to pass to payswarm.getJsonLd.
 * @param callback(err, config) called once the operation completes.
 */
api.getWellKnownConfig = function(host, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  if(typeof host !== 'string') {
    throw new TypeError('host must be a string of the form "host:port".');
  }

  host = api.normalizeHostUrl(host);
  var service = ('service' in options) ? options.service : 'payswarm';

  // get config
  // TODO: validate config
  var url = host + '/.well-known/' + service;
  api.getJsonLd(url, options.request, callback);
};

/**
 * Generates a PEM-formatted key pair.
 *
 * @param [options] the options to use:
 *          [keySize] the size of the key in bits (default: 2048).
 *          [publicExponent] the public exponent to use (default: 0x10001).
 * @param callback(err, pair) called once the operation completes.
 */
api.createKeyPair = function(options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  var keySize = options.keySize || 2048;
  var exponent = options.publicExponent || 0x10001;
  var keypair = ursa.generatePrivateKey(keySize, exponent);

  // get keys in PEM-format
  var privateKey = keypair.toPrivatePem('utf8');
  var publicKey = keypair.toPublicPem('utf8');

  callback(null, {privateKey: privateKey, publicKey: publicKey});
};

/**
 * Gets a PaySwarm Payment Processor's identity. This can be stored and used
 * later to confirm whether or not a digital receipt was provided by a trusted
 * PaySwarm Payment Processor.
 *
 * @param host the PaySwarm Payment Processor host and port.
 * @param [options] the options to use.
 *          [request] any options to pass to payswarm.getJsonLd.
 * @param callback(err, identity) called once the operation completes.
 */
api.getPaymentProcessorIdentity = function(host, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  api.getWellKnownConfig(host, options, function(err, config) {
    callback(err, err ? null : config.authorityIdentity);
  });
};

/**
 * Get the Web Key service's key registration URL, including the parameters
 * required to register a key.
 *
 * @param options the options to use.
 *          host the service host and port.
 *          key the PEM-formatted public key to use.
 *          [label] the label for the key.
 *          [callback] the callback URL for the registration result.
 *          [nonce] the nonce to use.
 *          [request] any options to pass to payswarm.getJsonLd.
 * @param callback(err, url) called once the operation completes.
 */
api.getWebKeyRegisterUrl = function(options, callback) {
  options = options || {};
  if(typeof options.host !== 'string') {
    throw new TypeError(
      'options.host must be a string of the form "host:port".');
  }
  if(typeof options.key !== 'string') {
    throw new TypeError('options.key must be a PEM-formatted string.');
  }
  api.getWellKnownConfig(
    options.host, {service: 'web-keys', request: options.request},
    function(err, config) {
      if(err) {
        return callback(err);
      }
      var query = {
        'public-key': options.key
      };
      if(options.label) {
        query['public-key-label'] = options.label;
      }
      if(options.callback) {
        query['registration-callback'] = options.callback;
      }
      if(options.nonce) {
        query['response-nonce'] = options.nonce;
      }
      callback(null, api.updateQuery(config.publicKeyService, query));
  });
};

/**
 * Completes the key registration process by verifying the response from the
 * Web Keys service. The resulting Web Keys IdentityPreferences object will
 * be returned in the callback.
 *
 * @param em the JSON-encoded encrypted registration response message.
 * @param callback(err, prefs) called once the operation completes.
 */
api.registerWebKey = function(em, callback) {
  // decrypt message
  api.decrypt(em, function(err, msg) {
    if(err) {
      return callback(err);
    }
    // check message type
    if(jsonld.hasType(msg, 'Error')) {
      return callback(new Error(
        '[payswarm.registerWebKey] ' + msg.errorMessage));
    }
    if(!jsonld.hasType(msg, 'IdentityPreferences')) {
      return callback(new Error(
        '[payswarm.registerWebKey] Web Key registration failed; invalid ' +
        'registration response from the Web Key service.'));
    }
    callback(null, msg);
  });
};

/**
 * Get the PaySwarm Payment Processors's vendor registration URL, including the
 * parameters required to register the vendor.
 *
 * @param options the options to use.
 *          host the PaySwarm Payment Processor host and port.
 *          callback the registration callback to use.
 *          key the PEM-formatted public key to use.
 *          nonce a nonce to use.
 *          [request] any options to pass to payswarm.getJsonLd.
 * @param callback(err, url) called once the operation completes.
 */
api.getRegisterVendorUrl = function(options, callback) {
  options = options || {};
  if(typeof options.host !== 'string') {
    throw new TypeError(
      'options.host must be a string of the form "host:port".');
  }
  if(typeof options.callback !== 'string') {
    throw new TypeError('options.callback must be a string.');
  }
  if(typeof options.key !== 'string') {
    throw new TypeError('options.key must be a PEM-formatted string.');
  }
  if(typeof options.nonce !== 'string') {
    throw new TypeError('options.nonce must be a string.');
  }
  // get core register URL from config
  api.getWellKnownConfig(options.host, options, function(err, config) {
    if(err) {
      return callback(err);
    }
    callback(null, api.updateQuery(config.vendorRegistrationService, {
      'public-key': options.key,
      'registration-callback': options.callback,
      'response-nonce': options.nonce
    }));
  });
};

/**
 * Completes the vendor registration process by verifying the response
 * from the PaySwarm Payment Processor.
 *
 * @param em the JSON-encoded encrypted registration response message.
 * @param options the options to use.
 *          key the PEM-formatted private key to decrypt with.
 *          [verify] any options to pass to payswarm.verify.
 * @param callback(err, prefs) called once the operation completes.
 */
api.registerVendor = function(em, options, callback) {
  options = options || {};
  if(typeof options.key !== 'string') {
    throw new TypeError('options.key must be a PEM-formatted string.');
  }
  async.auto({
    decrypt: function(callback) {
      api.decrypt(em, options.key, options.verify, callback);
    },
    checkMessage: ['decrypt', function(callback, results) {
      var prefs = results.decrypt;
      if(jsonld.hasValue(prefs, 'type', 'Error')) {
        return callback(new Error('[payswarm.registerVendor] ' +
          prefs.errorMessage));
      }
      if(!jsonld.hasValue(prefs, 'type', 'IdentityPreferences')) {
        return callback(new Error('[payswarm.registerVendor] ' +
          'Invalid registration response from PaySwarm Payment Processor.'));
      }
      callback();
    }]
  }, function(err, results) {
    callback(err, err ? null : results.decode);
  });
};

/**
 * Get the PaySwarm Payment Processor's purchase URL, including the parameters
 * identifying the Listing with the Asset to be purchased.
 *
 * @param options the options to use.
 *          host the PaySwarm Payment Processor host and port.
 *          listingId the ID (URL) for the Listing.
 *          listingHash the hash for the Listing.
 *          callback the purchase callback to use.
 *          nonce a nonce to use.
 *          [request] any options to pass to payswarm.getJsonLd.
 * @param callback(err, url) called once the operation completes.
 */
api.getPurchaseUrl = function(options, callback) {
  options = options || {};
  if(typeof options.host !== 'string') {
    throw new TypeError(
      'options.host must be a string of the form "host:port".');
  }
  if(typeof options.listingId !== 'string') {
    throw new TypeError('options.listingId must be a string.');
  }
  if(typeof options.listingHash !== 'string') {
    throw new TypeError('options.listingHash must be a string.');
  }
  if(typeof options.callback !== 'string') {
    throw new TypeError('options.callback must be a string.');
  }
  if(typeof options.nonce !== 'string') {
    throw new TypeError('options.nonce must be a string.');
  }
  // get core register URL from config
  api.getWellKnownConfig(options.host, options, function(err, config) {
    if(err) {
      return callback(err);
    }
    callback(null, api.updateQuery(config.paymentService, {
      listing: options.listingId,
      'listing-hash': options.listingHash,
      callback: options.callback,
      'response-nonce': options.nonce
    }));
  });
};

/**
 * Performs an automated purchase on behalf of a customer who has previously
 * authorized it.
 *
 * @param listing the listing object containing the asset to purchase.
 * @param options the options to use.
 *          identity the URL for the identity that is purchasing the asset.
 *          [sign] the payswarm.sign options to use to sign the
 *            purchase request.
 *          FIXME: transactionService undocumented -- should this be passed
 *            as an option or retrieved via the customer's PPP config?
 *          [source] the URL for the customer's financial account to use to
 *            pay for the asset (this may be omitted if a customer has
 *            previously associated a budget with the vendor that signed
 *            the listing).
 *          [verbose] true if debugging information should be printed to the
 *            console.
 *          [request] any options to pass to payswarm.getJsonLd.
 * @param callback(err, receipt) called once the operation completes.
 */
api.purchase = function(listing, options, callback) {
  async.auto({
    frame: function(callback) {
      jsonld.frame(listing, api.FRAMES.Listing, function(err, framed) {
        if(err) {
          return callback(err);
        }
        if(framed['@graph'].length === 0) {
          return callback(new Error('[payswarm.purchase] No Listings found.'));
        }
        if(framed['@graph'].length > 1) {
          return callback(new Error('[payswarm.purchase] ' +
            'More than one Listing found.'));
        }
        // extract listing from JSON-LD graph and set @context
        var listing = framed['@graph'][0];
        // TODO: validate listing
        listing['@context'] = api.CONTEXT_URL;
        callback(null, listing);
      });
    },
    hash: ['frame', function(callback, results) {
      api.hash(results.frame, callback);
    }],
    sign: ['hash', function(callback, results) {
      var purchaseRequest = {
        '@context': api.CONTEXT_URL,
        type: 'PurchaseRequest',
        identity: options.identity,
        listing: results.frame.id,
        listingHash: results.hash
      };
      if(options.source) {
        purchaseRequest.source = options.source;
      }
      api.sign(purchaseRequest, options.sign, callback);
    }],
    post: ['sign', function(callback, results) {
      if(options.verbose) {
        console.log('payswarm.purchase - POSTing purchase request to:',
          JSON.stringify(options.transactionService, null, 2));
        console.log('payswarm.purchase - Purchase Request:',
          JSON.stringify(results.sign, null, 2));
      }
      // post the purchase request to the transaction service
      api.postJsonLd(
        options.transactionService, results.sign,
        {request: options.request}, callback);
    }]
  }, function(err, results) {
    callback(err, err ? null : results.post);
  });
};

/**
 * Completes the purchase process by verifying the response from the PaySwarm
 * Payment Processor and returning the receipt.
 *
 * @param em the JSON-encoded encrypted purchase response message.
 * @param options the options to use.
 *          key the PEM-formatted private key to decrypt with.
 *          [verify] any options to pass to payswarm.verify.
 * @param callback(err, receipt) called once the operation completes.
 */
api.getReceipt = function(em, options, callback) {
  options = options || {};
  if(typeof options.key !== 'string') {
    throw new TypeError('options.key must be a PEM-formatted string.');
  }
  async.auto({
    decrypt: function(callback) {
      api.decrypt(em, options.key, options.verify, callback);
    },
    checkMessage: ['decrypt', function(callback, results) {
      var receipt = results.decrypt;
      if(jsonld.hasValue(receipt, 'type', 'Error')) {
        return callback(new Error('[payswarm.getReceipt] ' +
          receipt.errorMessage));
      }
      if(!jsonld.hasValue(receipt, 'type', 'Receipt')) {
        return callback(new Error('[payswarm.getReceipt] ' +
          'Invalid purchase response from PaySwarm Payment Processor.'));
      }
      callback();
    }],
    validate: ['checkMessage', function(callback, results) {
      var receipt = results.decryot;
      if(!('contract' in receipt || (typeof receipt.contract !== 'object'))) {
        return callback(new Error('[payswarm.getReceipt] ' +
          'Unknown Receipt format.'));
      }
      var contract = receipt.contract;
      if(!('assetAcquirer' in contract) ||
        !('asset' in contract) ||
        !('license' in contract)) {
        return callback(new Error('[payswarm.getReceipt] ' +
          'Unknown Contract format.'));
      }
      callback();
    }]
  }, function(err, results) {
    callback(err, err ? null : results.decrypt);
  });
};

/**
 * Adds query variables to an existing url.
 *
 * @param url the url to add the query vars to.
 * @param qvars the query variables to add, eg: {foo: 'bar'}.
 *
 * @return string the updated url.
 */
api.updateQuery = function(url, qvars) {
  var parsed = URL.parse(url, true);
  for(var key in qvars) {
    parsed.query[key] = qvars[key];
  }
  return URL.format(parsed);
};

/**
 * Determines whether or not the given Listing's validity period has passed.
 *
 * @param listing the Listing to check.
 *
 * @return true if the validity period still applies, false if not.
 */
api.isListingValid = function(listing) {
  var now = new Date();
  var validFrom = Date.parse(listing.validFrom);
  var validUntil = Date.parse(listing.validUntil);
  return (now >= validFrom && now <= validUntil);
};

/**
 * Gets the passed date in W3C format (eg: 2011-03-09T21:55:41Z).
 *
 * @param date the date.
 *
 * @return the date in W3C format.
 */
api.w3cDate = function(date) {
  if(date === undefined || date === null) {
    date = new Date();
  }
  return util.format('%d-%s-%sT%s:%s:%sZ',
    date.getUTCFullYear(),
    _zeroFill2(date.getUTCMonth() + 1),
    _zeroFill2(date.getUTCDate()),
    _zeroFill2(date.getUTCHours()),
    _zeroFill2(date.getUTCMinutes()),
    _zeroFill2(date.getUTCSeconds()));
};

function _zeroFill2(num) {
  return (num < 10) ? '0' + num : '' + num;
}

// use secure JSON-LD document loader
var nodeDocumentLoader = jsonld.documentLoaders.node({secure: true});
api.jsonLdDocumentLoader = function(url, callback) {
  var context = api.CONTEXTS[url];
  if(context) {
    return callback(null, {
      contextUrl: null,
      document: {'@context': context},
      documentUrl: url
    });
  }
  nodeDocumentLoader(url, callback);
};
jsonld.documentLoader = api.jsonLdDocumentLoader;
