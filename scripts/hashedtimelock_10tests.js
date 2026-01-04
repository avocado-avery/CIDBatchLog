/**
 * scripts/hashedtimelock_10tests.js
 *
 * Run:
 *   truffle migrate --reset --network development
 *   truffle exec scripts/hashedtimelock_10tests.js --network development
 *
 * Notes:
 * - Uses CID-style 32-byte preimages (0x + 64 hex chars).
 * - Computes hashlock = sha256(preimage) (matches your Solidity hashlock check).
 * - Sets timelock from chain time each test with a safe future buffer.
 *
 * IMPORTANT: Your Solidity must enforce 32 bytes, not 256:
 *   require(_preimage.length == 32, "preimage must be 32 bytes");
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HashedTimelock = artifacts.require("HashedTimelock");

const LOG_PATH = path.join(__dirname, "..", "hashedtimelock_testlog.txt");

function logLine(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  fs.appendFileSync(LOG_PATH, stamped + "\n", { encoding: "utf8" });
}

async function chainNow() {
  const b = await web3.eth.getBlock("latest");
  return Number(b.timestamp);
}

// 32-byte CID-style digest (0x + 64 hex chars)
function makePreimage32B() {
  return web3.utils.randomHex(32);
}

// sha256(bytes) -> bytes32 (0x + 64 hex chars)
function sha256HexOfBytesHex(hex0x) {
  const buf = Buffer.from(hex0x.slice(2), "hex");
  const digestHex = crypto.createHash("sha256").update(buf).digest("hex");
  return "0x" + digestHex;
}

function extractContractIdFromReceipt(receipt) {
  if (!receipt || !receipt.logs) return null;
  for (const l of receipt.logs) {
    if (!l.args) continue;
    if (l.args.contractId != null) return l.args.contractId;
    if (l.args.contractID != null) return l.args.contractID;
    if (l.args.id != null) return l.args.id;
  }
  return null;
}

module.exports = async function (callback) {
  try {
    fs.writeFileSync(
      LOG_PATH,
      `HashedTimelock 10-test run @ ${new Date().toISOString()}\n\n`,
      { encoding: "utf8" },
    );

    const accounts = await web3.eth.getAccounts();
    const sender = accounts[0];
    const receiver = accounts[1];

    logLine(`Using sender:   ${sender}`);
    logLine(`Using receiver: ${receiver}`);

    const instance = await HashedTimelock.deployed();
    logLine(`HashedTimelock deployed at: ${instance.address}`);

    const valueWei = "300000";

    // Safety buffer so futureTimelock never fails
    const FUTURE_BUFFER_SECONDS = 300; // 5 minutes
    const STAGGER_SECONDS = 2;

    for (let i = 1; i <= 10; i++) {
      const preimage32 = makePreimage32B(); // 32 bytes
      const hashlock = sha256HexOfBytesHex(preimage32); // 32 bytes
      const now = await chainNow();
      const timelock = now + FUTURE_BUFFER_SECONDS + i * STAGGER_SECONDS;

      logLine(`\n=== TEST ${i}/10 ===`);
      logLine(`preimage(32B): ${preimage32}`);
      logLine(`sha256(preimage) hashlock(bytes32): ${hashlock}`);
      logLine(`timelock(unix): ${timelock}`);
      logLine(`value: ${valueWei} wei`);

      // CREATE
      let createTx;
      try {
        createTx = await instance.newContract(receiver, hashlock, timelock, {
          from: sender,
          value: valueWei,
        });
      } catch (e) {
        logLine(`CREATE FAILED (test ${i}): ${e && e.message ? e.message : e}`);
        continue;
      }

      const contractId = extractContractIdFromReceipt(createTx.receipt);
      logLine(`create tx: ${createTx.tx}`);
      logLine(`create gasUsed: ${createTx.receipt.gasUsed}`);
      logLine(
        `contractId: ${contractId ? contractId.toString() : "NOT_FOUND"}`,
      );

      if (!contractId) {
        logLine(
          `WITHDRAW SKIPPED: could not determine contractId from LogHTLCNew event.`,
        );
        continue;
      }

      // WITHDRAW (receiver, before timelock)
      try {
        const withdrawTx = await instance.withdraw(contractId, preimage32, {
          from: receiver,
        });
        logLine(`withdraw tx: ${withdrawTx.tx}`);
        logLine(`withdraw gasUsed: ${withdrawTx.receipt.gasUsed}`);
        logLine(`WITHDRAW SUCCESS`);
      } catch (e) {
        logLine(
          `WITHDRAW FAILED (test ${i}): ${e && e.message ? e.message : e}`,
        );
        try {
          const c = await instance.getContract(contractId);
          logLine(
            `DEBUG getContract: sender=${c[0]} receiver=${c[1]} amount=${c[2].toString()} hashlock=${c[3]} timelock=${c[4].toString()} withdrawn=${c[5]} refunded=${c[6]}`,
          );
          logLine(
            `DEBUG sha256(preimage local)=${hashlock} hashlock(onchain)=${c[3]}`,
          );
        } catch (e2) {
          logLine(
            `DEBUG getContract failed: ${e2 && e2.message ? e2.message : e2}`,
          );
        }
      }
    }

    logLine(`\nDone. Log written to: ${LOG_PATH}`);
    callback();
  } catch (err) {
    console.error(err);
    callback(err);
  }
};
