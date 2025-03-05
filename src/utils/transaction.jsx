/*
YadaCoin Open Source License (YOSL) v1.1

Copyright (c) 2017-2025 Matthew Vogel, Reynold Vogel, Inc.

This software is licensed under YOSL v1.1 – for personal and research use only.
NO commercial use, NO blockchain forks, and NO branding use without permission.

For commercial license inquiries, contact: info@yadacoin.io

Full license terms: see LICENSE.txt in this repository.
*/

import { generateSHA256, generateSignatureWithPrivateKey } from "./hdWallet";

function equal(a, b, epsilon = 5e-9) {
  return Math.abs(a - b) < epsilon;
}

// Exception classes
class NotEnoughMoneyException extends Error {
  constructor(message) {
    super(message);
    this.name = "NotEnoughMoneyException";
  }
}

class MissingInputTransactionException extends Error {
  constructor(message) {
    super(message);
    this.name = "MissingInputTransactionException";
  }
}

export class Transaction {
  constructor(options = {}) {
    if (!options.key) {
      return;
    }
    if (!options.status) {
      this.status = "pending";
    }
    if (!options.txn_time) {
      this.txn_time = 0;
    }
    if (!options.outputs) {
      this.outputs = [];
    }
    if (!options.inputs) {
      this.inputs = [];
    }
    this.key = options.key;
    this.time =
      options.txn_time instanceof Number
        ? options.txn_time
        : parseFloat(options.txn_time || Math.floor(Date.now() / 1000));
    this.rid = options.rid || "";
    this.id = options.id;
    this.relationship = options.relationship || "";
    this.relationship_hash = options.relationship_hash || "";
    this.public_key = options.public_key || "";
    this.dh_public_key = options.dh_public_key || "";
    this.fee =
      options.fee instanceof Number
        ? options.fee
        : parseFloat(options.fee || 0);
    this.masternode_fee =
      options.masternode_fee instanceof Number
        ? options.masternode_fee
        : parseFloat(options.masternode_fee || 0);
    this.requester_rid = options.requester_rid || "";
    this.requested_rid = options.requested_rid || "";
    this.outputs = [];
    this.extra_blocks = options.extra_blocks;
    this.seed_gateway_rid = options.seed_gateway_rid;
    this.seed_rid = options.seed_rid;

    this.version = 7;
    if (options.outputs) {
      this.outputs = options.outputs.map((x) => {
        if (x instanceof Output) {
          return x;
        } else {
          return new Output(x);
        }
      });
    }

    if (options.inputs) {
      this.inputs = options.inputs.map((x) => {
        if (x instanceof Input) {
          return x;
        } else {
          return new Input(x);
        }
      });
    }

    this.coinbase = options.coinbase;
    this.miner_signature = options.miner_signature;
    this.contract_generated = options.contract_generated;
    this.never_expire = options.never_expire;
    this.private = options.private_txn;
    this.exact_match = options.exact_match;
    this.prerotated_key_hash = options.prerotated_key_hash;
    this.twice_prerotated_key_hash = options.twice_prerotated_key_hash;
    this.public_key_hash = options.public_key_hash;
    this.prev_public_key_hash = options.prev_public_key_hash || "";
  }

  async hashAndSign() {
    await this.generateHash();
    this.id = await generateSignatureWithPrivateKey(
      this.key.privateKey,
      this.hash
    );
  }

  async generateHash() {
    const concatenatedString =
      this.public_key +
      String(this.time) +
      this.dh_public_key +
      this.rid +
      this.relationship_hash +
      this.fee.toFixed(8) +
      this.masternode_fee.toFixed(8) +
      this.requester_rid +
      this.requested_rid +
      this.getInputHashes() +
      this.getOutputHashes() +
      String(this.version) +
      this.prerotated_key_hash +
      this.twice_prerotated_key_hash +
      this.public_key_hash +
      this.prev_public_key_hash;

    this.hash = await generateSHA256(concatenatedString);
  }

  getInputHashes() {
    return this.inputs
      .map((input) => input.id)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .join("");
  }

  getOutputHashes() {
    const outputsSorted = this.outputs
      .map((output) => ({
        to: output.to,
        value: output.value,
      }))
      .sort((a, b) => a.to.toLowerCase().localeCompare(b.to.toLowerCase()));
    return outputsSorted
      .map((output) => `${output.to}${output.value.toFixed(8)}`)
      .join("");
  }

  toJson() {
    return {
      public_key: this.public_key,
      time: this.time,
      dh_public_key: this.dh_public_key,
      rid: this.rid,
      inputs: this.inputs,
      outputs: this.outputs,
      relationship: this.relationship,
      relationship_hash: this.relationship_hash,
      fee: this.fee,
      masternode_fee: this.masternode_fee,
      requester_rid: this.requester_rid,
      requested_rid: this.requested_rid,
      version: this.version,
      prerotated_key_hash: this.prerotated_key_hash,
      twice_prerotated_key_hash: this.twice_prerotated_key_hash,
      public_key_hash: this.public_key_hash,
      prev_public_key_hash: this.prev_public_key_hash,
      hash: this.hash,
      id: this.id,
    };
  }
}

class Output {
  constructor(options = {}) {
    this.to = options.to;
    this.value = options.value || 0;
  }
}

class Input {
  constructor(options = {}) {
    this.id = options.id;
  }
}
