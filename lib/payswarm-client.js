/**
 * A JavaScript implementation of the PaySwarm API.
 *
 * @author Dave Longley
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
var async = require('async');
var crypto = require('crypto');
var forge = require('forge');
var jsonld = require('jsonld');
var request = require('request');
var URL = require('url');

var api = {};
module.exports = api;

/*

PAYSWARM CLIENT API
-------------------

The PaySwarm Client API allows vendors to register with a PaySwarm Authority,
sign listings for the items they wish to sell, and receive payments from
their customers.

INSTRUCTIONS
------------

First, implement all of the required hooks. Various hooks will be triggered
when making calls to the API. Most of the hooks involve providing the API with
a custom mechanism for doing HTTP GET/POST and storing/retrieving data from
a database. It is also highly recommended that the optional cache hooks be
implemented to prevent excessive network traffic when looking up PaySwarm
Authority configurations and public keys. To implement a hook, simply write
a function that takes the appropriate parameters and returns the appropriate
values. Then pass the hook name and the name of the custom function to
'payswarm.addHook'. Look below for the specific hooks that must be implemented.

Next, use the API to register as a vendor on the PaySwarm Authority of
choice, sign listings, and accept payments via customers' chosen PaySwarm
Authorities.

First, require this module:

var payswarm = require('payswarm-client');

Then:

1. Add the PaySwarm Authorities that should be trusted by calling:

  payswarm.addTrustedAuthority('trustedauthority:port');

  In this version of the API, any customer's PaySwarm Authority that the vendor
  would like to do business with must be manually added. The vendor's chosen
  PaySwarm Authority will be automatically added during the registration
  step.

2. Register as a vendor by calling:

  var url = payswarm.getRegisterVendorUrl(
    'myauthority:port',
    'http://myserver/myregistercallbackurl',
    callback);

  The first parameter is the host and port of the PaySwarm Authority to
  register with. The second is a callback URL that will receive the result of
  the registration as POST data.

  Direct the vendor to the URL so that they can complete the registration
  process. Once the registration process is complete, the vendor's browser
  will POST the registration result to the callback URL provided.

3. On the callback page, get the POST value 'encrypted-message' and pass it
  to register the vendor:

  payswarm.registerVendor(req.body['encrypted-message'], callback);

  If no error is given to the callback, registration is complete. The second
  callback parameter is the PaySwarm Vendor's Preferences, including the
  Financial Account ID to use in Listings.

5. Create a JSON-LD PaySwarm Asset and Listing. When listing an Asset, its
  unique hash must be in the Listing. To generate an asset hash call:

  payswarm.hash(asset, callback);

4. Sign a listing. Create a JSON-LD PaySwarm Listing and then sign it:

  payswarm.sign(listing, callback);

  Display the listing information; the use of RDFa is recommended. Depending
  on the application's needs, it is sometimes a good idea (or a requirement)
  to regenerate signatures when the vendor's public key is changed.

  Note: A Listing also contains a License for the Asset. If the application
  knows the ID (IRI) of the License to use but not the License hash, and it
  does not have the necessary parser to obtain the License information from
  its ID, it may use the PaySwarm Authority's license service to cache and
  retrieve the License by its ID. Then payswarm.hash(license, callback) can
  be called on the result to produce its hash.

5. When a customer indicates that they want to purchase the Asset in a
  Listing, call:

  var url = payswarm.getPurchaseUrl(
    'customersauthority:port',
    listingId,
    listingHash,
    'https://myserver/mypurchasecallbackurl',
    callback);

  To get a URL to redirect the customer to their PaySwarm Authority to
  complete the purchase. The last parameter is a callback URL that will
  receive the result of the purchase as POST data.

  If the customer has previously completed a purchase and the response
  indicated that they set up a budget to handle automated purchases in the
  future, then an automated purchase can be attempted by calling:

  payswarm.purchase(
    'customersauthority:port',
    'https://customersauthority:port/i/customer',
    listingId,
    listingHash,
    callback);

  In this version of the API, it is the responsibility of the application to
  determine the customer's PaySwarm Authority (usually by asking). A listing
  hash can be generated by calling:

  payswarm.hash(listing, callback);

  To get the JSON-LD receipt from a purchase, call:

  payswarm.getReceipt(encryptedMessage, callback);

  Where encryptedMessage is either the result of a POST to the purchase
  callback or the result of the payswarm.purchase() call.

  The receipt will indicate the ID and hash of the Asset purchased as well
  as the ID and hash of the License for the Asset.

*/

// FIXME: ported from PHP, use more nodejs-like idioms, pass 'cache' or
// 'store' objects that have interfaces to be implemented, etc.

// hook API
var hooks = {};

/**
 * Adds a hook. To add a hook, pass the name of the hook (eg: createNonce) and
 * the user-defined function name to be called. Hooks are permitted to throw
 * exceptions as are any PaySwarm client API calls. API calls should be
 * wrapped in try/catch blocks as appropriate.
 *
 * Required protocol hooks:
 *
 * createNonce(): Creates and stores a nonce that is to be given to a
 *   PaySwarm Authority so it can be returned in a signed and encrypted
 *   message.
 *
 * checkNonce(nonce, callback(err, valid)): Checks a nonce previously created
 *   by createNonce and removes it from storage. Passes true in the callback
 *   if the nonce is valid, false if not.
 *
 * getJsonLd(url, callback(err, result)): Passes the JSON-encoded body of an
 *   HTTP GET in the callback where the expected content-type is
 *   'application/ld+json'.
 *
 * postJsonLd(url, data): HTTP POSTs the given JSON-LD data to the given
 *   URL and returns the response body.
 *
 * Required storage hooks:
 *
 * getPublicKey(callback(err, key)): Passes the vendor's public key in PEM
 * format to the callback.
 *
 * getPublicKeyId(callback(err, id)): Passes the ID (IRI) for the vendor's
 * public key to the callback.
 *
 * getPrivateKey(callback(err, key)): Passes the vendor's private key in
 * PEM format to the callback.
 *
 * isTrustedAuthority(id, callback(err, trusted)): Passes true to the
 *   callback if the given identity (IRI) is a trusted PaySwarm Authority,
 *   false if not.
 *
 * storeKeyPair(publicPem, privatePem, callback(err)): Stores the vendor's
 * key pair.
 *
 * storePublicKeyId(id, callback(err)): Stores the vendor's public key ID
 * (IRI).
 *
 * storeTrustedAuthority(id, callback(err)): Stores the ID (IRI) of a trusted
 *   PaySwarm Authority.
 *
 * Optional cache hooks:
 *
 * cacheJsonLd(id, obj, secs, callback(err)): Caches a JSON-LD object. The
 *   ID (IRI) for the object is given and the maxmimum number of seconds to
 *   cache.
 *
 * getCachedJsonLd(id, callback(err, result)): Gets a JSON-LD object from
 *   cache. Passes the object or null to the callback.
 *
 * @param hook the name of the hook.
 * @param func the name of the function to call.
 */
api.addHook = function(hook, func) {
  hooks[hook] = func;
};

/**
 * Creates a default payswarm JSON-LD context.
 *
 * @return the default payswarm JSON-LD context.
 */
api.createDefaultJsonLdContext = function() {
  return {
    // aliases
    'id': '@id',
    'type': '@type',

    // prefixes
    'ccard': 'http://purl.org/commerce/creditcard#',
    'com': 'http://purl.org/commerce#',
    'dc': 'http://purl.org/dc/terms/',
    'foaf': 'http://xmlns.com/foaf/0.1/',
    'gr': 'http://purl.org/goodrelations/v1#',
    'ps': 'http://purl.org/payswarm#',
    'psp': 'http://purl.org/payswarm/preferences#',
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
    'sec': 'http://purl.org/security#',
    'vcard': 'http://www.w3.org/2006/vcard/ns#',
    'xsd': 'http://www.w3.org/2001/XMLSchema#',

    // general
    'address': {'@id': 'vcard:adr', '@type': '@id'},
    'comment': 'rdfs:comment',
    'countryName': 'vcard:country-name',
    'created': {'@id': 'dc:created', '@type': 'xsd:dateTime'},
    'creator': {'@id': 'dc:creator', '@type': '@id'},
    'depiction': {'@id': 'foaf:depiction', '@type': '@id'},
    'description': 'dc:description',
    'email': 'foaf:mbox',
    'fullName': 'vcard:fn',
    'homepage': {'@id': 'foaf:homepage', '@type': '@id'},
    'label': 'rdfs:label',
    'locality': 'vcard:locality',
    'postalCode': 'vcard:postal-code',
    'region': 'vcard:region',
    'streetAddress': 'vcard:street-address',
    'title': 'dc:title',

    // bank
    'bankAccount': 'bank:account',
    'bankRouting': 'bank:routing',

    // credit card
    'cardAddress': {'@id': 'ccard:address', '@type': '@id'},
    'cardBrand': {'@id': 'ccard:brand', '@type': '@id'},
    'cardCvm': 'ccard:cvm',
    // FIXME: use xsd mo/yr types?
    'cardExpMonth': 'ccard:expMonth',
    'cardExpYear': 'ccard:expYear',
    'cardNumber': 'ccard:number',

    // commerce
    'account': {'@id': 'com:account', '@type': '@id'},
    'accountOwnerType': {'@id': 'com:accountOwnerType', '@type': '@id'},
    'amount': 'com:amount',
    'balance': 'com:balance',
    'currency': 'com:currency',
    'destination': {'@id': 'com:destination', '@type': '@id'},
    'escrow': 'com:escrow',
    'forTransaction': {'@id': 'com:forTransaction', '@type': '@id'},
    'maximumAmount': 'com:maximumAmount',
    'maximumPayeeRate': 'com:maximumPayeeRate',
    'minimumAmount': 'com:minimumAmount',
    'payee': {'@id': 'com:payee', '@type': '@id', '@container': '@set'},
    'payeeRule': {'@id': 'com:payeeRule', '@type': '@id', '@container': '@set'},
    'payeeLimitation': {'@id': 'com:payeeLimitation', '@type': '@id'},
    // FIXME: be more strict with nonNegativeInteger?
    'payeePosition': {'@id': 'com:payeePosition', '@type': 'xsd:integer'},
    'payeeRate': 'com:payeeRate',
    'payeeRateContext': {'@id': 'com:payeeRateContext', '@type': '@id'},
    'payeeRateType': {'@id': 'com:payeeRateType', '@type': '@id'},
    'paymentGateway': 'com:paymentGateway',
    'paymentMethod': {'@id': 'com:paymentMethod', '@type': '@id'},
    'paymentToken': 'com:paymentToken',
    'referenceId': 'com:referenceId',
    'settled': {'@id': 'com:settled', '@type': 'xsd:dateTime'},
    'source': {'@id': 'com:source', '@type': '@id'},
    'transfer': {'@id': 'com:transfer', '@type': '@id'},
    'vendor': {'@id': 'com:vendor', '@type': '@id'},
    'voided': {'@id': 'com:voided', '@type': 'xsd:dateTime'},

    // error
    // FIXME
    // 'errorMessage': 'err:message'

    // payswarm
    'asset': {'@id': 'ps:asset', '@type': '@id'},
    'assetAcquirer': {'@id': 'ps:assetAcquirer', '@type': '@id'},
    // FIXME: support inline content
    'assetContent': {'@id': 'ps:assetContent', '@type': '@id'},
    'assetHash': 'ps:assetHash',
    'assetProvider': {'@id': 'ps:assetProvider', '@type': '@id'},
    'authority': {'@id': 'ps:authority', '@type': '@id'},
    'identityHash': 'ps:identityHash',
    // FIXME: move?
    'ipv4Address': 'ps:ipv4Address',
    'license': {'@id': 'ps:license', '@type': '@id'},
    'licenseHash': 'ps:licenseHash',
    'licenseTemplate': 'ps:licenseTemplate',
    'licenseTerms': {'@id': 'ps:licenseTerms', '@type': '@id'},
    'listing': {'@id': 'ps:listing', '@type': '@id'},
    'listingHash': 'ps:listingHash',
    // FIXME: move?
    'owner': {'@id': 'ps:owner', '@type': '@id'},
    'preferences': {'@id': 'ps:preferences', '@type': '@id'},
    'validFrom': {'@id': 'ps:validFrom', '@type': 'xsd:dateTime'},
    'validUntil': {'@id': 'ps:validUntil', '@type': 'xsd:dateTime'},

    // security
    'cipherAlgorithm': 'sec:cipherAlgorithm',
    'cipherData': 'sec:cipherData',
    'cipherKey': 'sec:cipherKey',
    'digestAlgorithm': 'sec:digestAlgorithm',
    'digestValue': 'sec:digestValue',
    'expiration': {'@id': 'sec:expiration', '@type': 'xsd:dateTime'},
    'initializationVector': 'sec:initializationVector',
    'nonce': 'sec:nonce',
    'normalizationAlgorithm': 'sec:normalizationAlgorithm',
    'password': 'sec:password',
    'privateKey': {'@id': 'sec:privateKey', '@type': '@id'},
    'privateKeyPem': 'sec:privateKeyPem',
    'publicKey': {'@id': 'sec:publicKey', '@type': '@id'},
    'publicKeyPem': 'sec:publicKeyPem',
    'publicKeyService': {'@id': 'sec:publicKeyService', '@type': '@id'},
    'revoked': {'@id': 'sec:revoked', '@type': '@id'},
    'signature': 'sec:signature',
    'signatureAlgorithm': 'sec:signatureAlgorithm',
    'signatureValue': 'sec:signatureValue'
  };
};

/**
 * Retrieves a JSON-LD object over HTTP.
 *
 * @param url the URL to HTTP GET.
 * @param options:
 *          cache true to cache the response.
 * @param callback(err, result) called once the operation completes.
 */
api.getJsonLd = function(url, options, callback) {
  async.waterfall([
    function(callback) {
      // use cache if available
      api.getCachedJsonLd(url, callback);
    },
    function(result, callback) {
      if(result) {
        return callback(null, result);
      }

      // retrieve JSON-LD
      hooks.getJsonLd(url, callback);
    },
    function(result, callback) {
      try {
        var parsed = JSON.parse(result);
      }
      catch(ex) {
        return callback(new Error(
          'Invalid response from "' + url + '"; malformed JSON.'));
      }

      // cache JSON-LD
      if(options.cache) {
        return api.cacheJsonLd(url, result, function(err) {
          callback(err, parsed);
        });
      }
      callback(null, parsed);
    }
  ], callback);
};

/**
 * HTTP POSTs a JSON-LD object.
 *
 * @param url the URL to HTTP POST to.
 * @param obj the JSON-LD object.
 * @param callback(err, result) called once the operation completes.
 */
api.postJsonLd = function(url, obj, callback) {
  async.waterfall([
    function(callback) {
      hooks.postJsonLd(url, JSON.stringify(obj), callback);
    },
    function(result, callback) {
      try {
        // parse response
        callback(null, JSON.parse(result));
      }
      catch(ex) {
        callback(new Error(
          'Invalid response from "' + url + '"; malformed JSON.'));
      }
    }
  ], callback);
};

/**
 * Caches a JSON-LD object if a cache is available.
 *
 * @param id the ID of the JSON-LD object.
 * @param obj the JSON-LD object to cache.
 * @param callback(err) called once the operation completes.
 */
api.cacheJsonLd = function(id, obj, callback) {
  if('cacheJsonLd' in hooks) {
    return hooks.cacheJsonLd(id, obj, 60*5, callback);
  }
  // no cache
  callback();
};

/**
 * Gets a cached JSON-LD object if available.
 *
 * @param id the ID of the JSON-LD object.
 * @param callback(err, result) called once the operation completes.
 */
api.getCachedJsonLd = function(id, callback) {
  if('getCachedJsonLd' in hooks) {
    return hooks.getCachedJsonLd(id, callback);
  }
  callback(null, null);
};

/**
 * Resolves a JSON-LD context URL, returning the context.
 *
 * @param url the URL for the JSON-LD context.
 * @param callback(err, ctx) called once the operation completes.
 */
api.resolveUrl = function(url, callback) {
  // FIXME: hack until http://purl.org/payswarm/v1 is ready
  if(url === 'http://purl.org/payswarm/v1') {
    return callback(null, {'@context': api.createDefaultJsonLdContext()});
  }
  api.getJsonLd(url, {cache: true}, callback);
};

/**
 * Gets a remote public key.
 *
 * @param id the ID for the public key.
 * @param callback(err, key) called once the operation completes.
 */
api.getPublicKey = function(id, callback) {
  // retrieve public key
  api.getJsonLd(id, {cache: false}, function(err, key) {
    if(!('publicKeyPem' in key)) {
      return callback(new Error('PaySwarm Security Exception: ' +
        'Could not get public key. Unknown format.'));
    }

    // cache public key
    api.cacheJsonLd(id, key, function(err) {
      if(err) {
        return callback(err);
      }
      callback(null, key);
    });
  });
};

/**
 * Creates a nonce for a secure message.
 *
 * @param callback(err, nonce) called once the operation completes.
 */
api.createNonce = function(callback) {
  hooks.createNonce(callback);
};

/**
 * Checks the nonce from a secure message.
 *
 * @param nonce the nonce.
 * @param callback(err, valid) called once the operation completes.
 */
api.checkNonce = function(nonce, callback) {
  hooks.checkNonce(nonce, callback);
};

/**
 * Generates a hash of the JSON-LD encoded data.
 *
 * @param obj the JSON-LD object to hash.
 * @param callback(err, hash) called once the operation completes.
 */
api.hash = function(obj, callback) {
  // SHA-1 hash JSON
  jsonld.normalize(obj, {format: 'application/nquads'}, function(err, result) {
    if(err) {
      return callback(err);
    }
    var md = crypto.createHash('sha1');
    md.update(result, 'utf8');
    callback(null, md.digest('hex'));
  });
};

/**
 * Signs a JSON-LD object, adding a signature field to it. If a signature
 * date is not provided then the current date will be used.
 *
 * @param obj the JSON-LD object to sign.
 * @param [nonce] the nonce to use.
 * @param [date] the signature creation date.
 * @param callback(err, signed) called once the operation completes.
 */
api.sign = function(obj, nonce, date, callback) {
  // handle arguments
  if(nonce instanceof Date) {
    nonce = null;
    date = nonce;
    callback = arguments[2];
  }
  if(typeof nonce === 'function') {
    nonce = null;
    callback = nonce;
  }
  if(typeof date === 'function') {
    date = null;
    callback = date;
  }

  // get W3C-formatted date
  if(!date) {
    date = new Date();
  }
  if(typeof date !== 'string') {
    date = api.w3cDate(date);
  }

  async.auto({
    getPrivateKey: function(callback) {
      hooks.getPrivateKey(callback);
    },
    getPublicKeyId: function(callback) {
      hooks.getPublicKeyId(callback);
    },
    normalize: function(callback) {
      jsonld.normalize(obj, {format: 'application/nquads'}, callback);
    },
    sign: ['getPrivateKey', 'normalize', function(callback, results) {
      var pem = results.getPrivateKey;
      var normalized = results.normalize;
      // generate base64-encoded signature
      var signer = crypto.createSign('RSA-SHA1');
      if(nonce !== null) {
        signer.update(nonce);
      }
      signer.update(date);
      signer.update(normalized);
      var signature = signer.sign(pem, 'base64');
      callback(null, signature);
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }

    // create signature info
    var signInfo = {
      type: 'sec:GraphSignature2012',
      creator: results.getPublicKeyId,
      created: date,
      signatureValue: results.sign
    };
    if(nonce !== null) {
      signInfo.nonce = nonce;
    }
    // FIXME: support multiple signatures
    obj.signature = signInfo;
    callback(null, obj);
  });
};

/**
 * Verifies a JSON-LD digitally-signed object.
 *
 * @param obj the JSON-LD object to verify.
 * @param callback(err) called once the operation completes.
 */
api.verify = function(obj) {
  async.auto({
    frame: function(callback) {
      // frame message to retrieve signature
      var frame = {
        '@context': api.createDefaultJsonLdContext(),
        signature: {
          created: {},
          creator: {},
          signatureValue: {},
          nonce: {'@omitDefault': true}
        }
      };
      jsonld.frame(obj, frame, function(err, framed) {
        if(err) {
          return callback(err);
        }
        if(obj['@graph'].length === 0 ||
          obj['@graph'][0].signature === null) {
          return callback(new Error('PaySwarm Security Exception: ' +
            'The message is not digitally signed.'));
        }
        callback(null, obj['@graph'][0]);
      });
    },
    checkNonce: ['frame', function(callback, results) {
      var signInfo = results.frame.signature;
      if('nonce' in signInfo) {
        return api.checkNonce(signInfo.nonce, function(err, valid) {
          if(err) {
            return callback(err);
          }
          if(!valid) {
            return callback(new Error('PaySwarm Security Exception: ' +
            'The message nonce is invalid.'));
          }
          callback();
        });
      }
      callback();
    }],
    checkDate: ['frame', function(callback, results) {
      // ensure signature timestamp is +/- 15 minutes
      var now = +new Date();
      try {
        var signInfo = results.frame.signature;
        var created = +Date.parse(signInfo.created);
        if(created < (now - 15*60) || created > (now + 15*60)) {
          throw new Error('PaySwarm Security Exception: ' +
            'The message digital signature timestamp is out of range.');
        }
      }
      catch(ex) {
        callback(ex);
      }
    }],
    getPublicKey: ['frame', function(callback, results) {
      var signInfo = results.frame.signature;
      api.getPublicKey(signInfo.creator, callback);
    }],
    verifyPublicKeyOwner: ['getPublicKey', function(callback, results) {
      var key = results.getPublicKey;
      hooks.isTrustedAuthority(key.owner, function(err, trusted) {
        if(err) {
          return callback(err);
        }
        if(!trusted) {
          return callback(new Error('PaySwarm Security Exception: ' +
          'The message is not signed by a trusted public key.'));
        }
        callback();
      });
    }],
    normalize: ['checkNonce', 'checkDate', 'verifyPublicKeyOwner',
      function(callback, results) {
        // remove signature property from object
        var result = results.frame;
        var signInfo = result.signature;
        delete result.signature;

        jsonld.normalize(result, {format: 'application/nquads'},
          function(err, normalized) {
            if(err) {
              return callback(err);
            }
            callback(null, {data: normalized, signInfo: signInfo});
        });
    }],
    verifySignature: ['normalize', function(callback, results) {
      var verifier = crypto.createVerify('RSA-SHA1');
      if('nonce' in signInfo) {
        verifier.update(signInfo.nonce);
      }
      verifier.update(signInfo.created);
      verifier.update(results.normalize.data);
      var verified = verifier.verify(
        results.getPublicKey.publicKeyPem,
        signInfo.signatureValue, 'base64');
      if(!verified) {
        return callback(new Error('PaySwarm Security Exception: ' +
          'The digital signature on the message is invalid.'));
      }
      callback();
    }]
  }, callback);
};

/**
 * Decrypts an encrypted JSON-LD object.
 *
 * @param encrypted the message to decrypt.
 * @param callback(err, result) called once the operation completes.
 */
api.decrypt = function(encrypted, callback) {
  if(encrypted.cipherAlgorithm !== 'rsa-aes-128-cbc') {
    var algorithm = encrypted.cipherAlgorithm;
    return callback(new Error('PaySwarm Security Exception: ' +
      'Unknown encryption algorithm "' + algorithm + '"'));
  }

  async.auto({
    getPrivateKey: function(callback) {
      hooks.getPrivateKey(callback);
    },
    decrypt: ['getPrivateKey', function(callback, results) {
      try {
        // private key decrypt key and IV
        var keypair = rsa.createRsaKeypair({
          privateKey: results.getPrivateKey.privateKeyPem
        });
        var key = keypair.decrypt(
          encrypted.cipherKey, 'base64', 'binary');
        var iv = keypair.decrypt(
          encrypted.initializationVector, 'base64', 'binary');

        // symmetric decrypt data
        var decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        var decrypted = decipher.update(
          encrypted.cipherData, 'base64', 'utf8');
        decrypted += decipher.final('base64');

        // return parsed result
        var result = JSON.parse(decrypted);
        callback(null, result);
      }
      catch(ex) {
        callback(new Error('PaySwarm Security Exception: ' +
          'Failed to decrypt the encrypted message.'));
      }
    }]
  }, function(err, results) {
    callback(err, results.decrypt);
  });
};

/**
 * Decodes a JSON-encoded, encrypted, digitally-signed message from a
 * PaySwarm Authority.
 *
 * @param msg the json-encoded message to verify.
 * @param callback(err, result) called once the operation completes.
 */
api.decodeAuthorityMessage = function(msg, callback) {
  try {
    // convert message from json
    msg = JSON.parse(msg);
  }
  catch(ex) {
    return callback(new Error('PaySwarm Security Exception: ' +
      'The message contains malformed JSON.'));
  }

  // decrypt and verify message
  async.waterfall([
    function(callback) {
      api.decrypt(msg, callback);
    },
    function(result, callback) {
      api.verify(result, function(err) {
        if(err) {
          return callback(err);
        }
        callback(null, result);
      });
    }
  ], callback);
};

/**
 * Gets the config for a PaySwarm Authority.
 *
 * @param host the PaySwarm Authority host and port.
 * @param callback(err, config) called once the operation completes.
 */
api.getAuthorityConfig = function(host, callback) {
  // get config
  var url = 'https://' + host + '/payswarm-v1-config';
  api.getJsonLd(url, {cache: true}, callback);
  // TODO: validate config
};

/**
 * Caches a license at the PaySwarm Authority and returns the result.
 *
 * @param host the PaySwarm Authority host and port.
 * @param id the ID of the license to cache.
 * @param callback(err, result) called once the operation completes.
 */
api.cacheLicenseAtAuthority = function(host, id) {
  async.auto({
    getConfig: function(callback) {
      api.getAuthorityConfig(host, callback);
    },
    sign: function(callback) {
      var msg = {
        '@context': api.createDefaultJsonLdContext(),
        license: id
      };
      api.sign(msg, callback);
    },
    post: ['getConfig', 'sign', function(callback, results) {
      var url = results.getConfig.licensesService;
      var msg = results.sign;
      api.postJsonLd(url, msg, callback);
    }],
    checkLicense: ['post', function(callback, results) {
      var license = results.post;
      if(license === null || typeof license !== 'object') {
        return callback(new Error('PaySwarm Exception: ' +
          'Invalid response when caching license.'));
      }
      // FIXME: use JSON-LD exceptions
      if('message' in license) {
        return callback(new Error('PaySwarm Exception: ' +
          'Error while caching license: ' + license['message']));
      }
      callback(null, license);
    }]
  }, function(err, results) {
    callback(err, results.checkLicense);
  });
};

/**
 * Generates a PEM-encoded key pair and stores it by calling the
 * 'storeKeyPair' hook.
 *
 * @param callback(err, pair) called once the operation completes.
 */
api.createKeyPair = function(callback) {
  // create key-generation state and function to step algorithm
  var state = forge.pki.rsa.createKeyPairGenerationState(2048);
  function step() {
    if(forge.pki.rsa.stepKeyPairGenerationState(state, 1)) {
      // get keys in PEM-format
      var privateKey = forge.pki.privateKeyToPem(state.keys.privateKey);
      var publicKey = forge.pki.publicKeyToPem(state.keys.publicKey);

      // store key pair
      return hooks.storeKeyPair(publicKey, privateKey, function(err) {
        if(err) {
          return callback(err);
        }
        callback(null, {privateKey: privateKey, publicKey: publicKey});
      });
    }
    process.nextTick(step);
  };
  process.nextTick(step);
};

/**
 * Adds a trusted PaySwarm Authority. Only trusted PaySwarm Authorities can
 * be used in financial transactions.
 *
 * @param host the PaySwarm Authority host and port.
 * @param callback(err) called once the operation completes.
 */
api.addTrustedAuthority = function(host, callback) {
  // get authority config
  api.getAuthorityConfig(host, function(err, config) {
    if(err) {
      return callback(err);
    }

    // store authority identity
    var id = config.authorityIdentity;
    hooks.storeTrustedAuthority(id, callback);
  });
};

/**
 * Get the PaySwarm Authority's vendor registration URL, including the
 * parameters required to register the vendor. If a key pair does not exist
 * it will be generated, otherwise the existing key pair will be used unless
 * overwriteKeyPair is set to true.
 *
 * @param host the PaySwarm Authority host and port.
 * @param registrationCallback the registrationCallback to use.
 * @param options the options to use:
 *          overwriteKeyPair true to generate a new key-pair even if
 *            there is an existing one.
 * @param callback(err, url) called once the operation completes.
 */
api.getRegisterVendorUrl = function(
  host, registrationCallback, options, callback) {
  async.auto({
    trustedAuthority: function(callback) {
      // automatically trust given payswarm authority
      api.addTrustedAuthority(host, callback);
    },
    getRegisterUrl: function(callback) {
      // get register URL from authority config
      api.getAuthorityConfig(host, function(err, config) {
        if(err) {
          return callback(err);
        }
        callback(null, config.vendorRegistrationService);
      });
    },
    getPublicKey: function(callback) {
      // use existing public key if overwrite is not specified
      if(!options.overwriteKeyPair) {
        return hooks.getPublicKey(callback);
      }
      // no public key available (or overwriting), generate new key pair
      api.createKeyPair(function(err, pair) {
        if(err) {
          return callback(err);
        }
        callback(null, pair.publicKey);
      });
    },
    createNonce: function(callback) {
      api.createNonce(callback);
    }
  }, function(err, results) {
    if(err) {
      return callback(err);
    }

    // add query parameters to the register URL
    var url = addQueryVars(results.getRegisterUrl, {
      'public-key': results.getPublicKey,
      'registration-callback': registrationCallback,
      'response-nonce': results.createNonce
    });
    callback(null, url);
  });
};

/**
 * Completes the vendor registration process by verifying the response
 * from the PaySwarm Authority.
 *
 * @param msg the JSON-encoded encrypted registration response message.
 * @param callback(err, prefs) called once the operation completes.
 */
api.registerVendor = function(msg, callback) {
  async.auto({
    decode: function(callback) {
      api.decodeAuthorityMessage(msg, callback);
    },
    checkMessage: ['decode', function(callback, results) {
      var prefs = results.decode;
      if(jsonld.hasValue(prefs, 'type', 'err:Error')) {
        return callback(new Error('PaySwarm Registration Exception: ' +
          prefs.errorMessage));
      }
      if(!jsonld.hasValue(prefs, 'type', 'ps:Preferences')) {
        return callback(new Error('PaySwarm Registration Exception: ' +
          'Invalid registration response from PaySwarm Authority.'));
      }
      callback();
    }],
    storePublicKeyId: ['checkMessage', function(callback, results) {
      var prefs = results.decode;
      hooks.storePublicKeyId(prefs.publicKey, callback);
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    callback(null, results.decode);
  });
};

/**
 * Get the PaySwarm Authority's purchase URL, including the parameters
 * identifying the Listing with the Asset to be purchased.
 *
 * @param host the PaySwarm Authority host and port.
 * @param listingId the ID (IRI) for the Listing.
 * @param listingHash the hash for the Listing.
 * @param purchaseCallback the callback URL for the purchase result.
 * @param callback(err, url) called once the operation completes.
 */
api.getPurchaseUrl = function(
  host, listingId, listingHash, purchaseCallback, callback) {
  async.auto({
    getPurchaseUrl: function(callback) {
      // get purchase URL from authority config
      api.getAuthorityConfig(host, function(err, config) {
        if(err) {
          return callback(err);
        }
        callback(null, config.paymentService);
      });
    },
    createNonce: function(callback) {
      api.createNonce(callback);
    }
  }, function(err, results) {
    if(err) {
      return callback(err);
    }

    // add query parameters to the register URL
    var url = addQueryVars(results.getPurchaseUrl, {
      listing: listingId,
      'listing-hash': listingHash,
      callback: purchaseCallback,
      'response-nonce': results.createNonce
    });
    callback(null, url);
  });
};

/**
 * Performs an automated purchase on behalf of a customer who has previously
 * authorized it.
 *
 * @param host the PaySwarm Authority host and port.
 * @param id the ID (IRI) of the customer.
 * @param listingId the ID (IRI) for the Listing.
 * @param listingHash the hash for the Listing.
 * @param callback(err, encrypted) called once the operation completes.
 */
api.purchase = function(host, id, listingId, listingHash, callback) {
  // TODO: implement
  callback(new Error('Not implemented'));
};

/**
 * Completes the purchase process by verifying the response from the PaySwarm
 * Authority and returning the receipt.
 *
 * @param msg the JSON-encoded encrypted purchase response message.
 * @param callback(err, receipt) called once the operation completes.
 */
api.getReceipt = function(msg, callback) {
  async.auto({
    decode: function(callback) {
      api.decodeAuthorityMessage(msg, callback);
    },
    checkMessage: ['decode', function(callback, results) {
      var receipt = results.decode;
      if(jsonld.hasValue(receipt, 'type', 'err:Error')) {
        return callback(new Error('PaySwarm Purchase Exception: ' +
          receipt['err:message']));
      }
      // FIXME: use ps:Receipt
      if(!jsonld.hasValue(receipt, 'type', 'ps:Contract')) {
        return callback(new Error('PaySwarm Registration Exception: ' +
          'Invalid purchase response from PaySwarm Authority.'));
      }
      callback();
    }],
    validate: ['checkMessage', function(callback, results) {
      var receipt = results.decode;
      if(!('assetAcquirer' in receipt) ||
        !('asset' in receipt) ||
        !('license' in receipt)) {
        return callback(new Error('PaySwarm Purchase Exception: ' +
          'Unknown Contract format.'));
      }
      callback();
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    callback(null, results.decode);
  });
};

/**
 * Add query variables to an existing url.
 *
 * @param url the url to add the query vars to.
 * @param qvars the query variables to add, eg: {foo: 'bar'}.
 *
 * @return string the updated url.
 */
api.addQueryVars = function(url, qvars) {
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
  try {
    var now = new Date();
    var validFrom = Date.parse(listing.validFrom);
    var validUntil = Date.parse(listing.validUntil);
    return (now >= validFrom && now <= validUntil);
  }
  catch(ex) {
    return false;
  }
};

/**
 * Default POST JSON-LD hook.
 *
 * @param url the URL.
 * @param data the JSON-LD data.
 * @param callback(err, result) called once the operation completes.
 */
api.defaultPostJsonLd = function(url, data, callback) {
  request.post({
    url: url,
    json: data,
    encoding: 'utf8',
    headers: {'Accept': 'application/json'}
  }, function(err, res, body) {
    callback(err, body);
  });
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

/** Default GET/POST JSON-LD hooks. */
api.addHook('getJsonLd', api.resolveUrl);
api.addHook('postJsonLd', api.defaultPostJsonLd);