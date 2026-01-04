/**
 * scripts/hashedtimelock_log_10tests.js
 *
 * Run:
 *   truffle migrate --reset --network development
 *   truffle exec scripts/hashedtimelock_log_10tests.js --network development
 *
 * Matches HashedTimelockLog (32-byte preimage):
 *   newContract(address receiver, bytes32 hashlock, bytes32 messageHash, uint timelock)
 *   withdraw(bytes32 contractId, bytes32 preimage32)
 *   verifyLog(bytes32 contractId, bytes message)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HashedTimelockLog = artifacts.require("HashedTimelockLog");

const LOG_PATH = path.join(__dirname, "..", "hashedtimelock_log_testlog.txt");

/* ───────────── Logging helpers ───────────── */

function logLine(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  fs.appendFileSync(LOG_PATH, stamped + "\n", { encoding: "utf8" });
}

/* ───────────── Helpers ───────────── */

// sha256(bytes32 hex) -> bytes32 hex
function sha256OfBytes32Hex(bytes32hex) {
  const buf = Buffer.from(bytes32hex.slice(2), "hex");
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

async function chainNow() {
  const b = await web3.eth.getBlock("latest");
  return Number(b.timestamp);
}

// CID-style digest (bytes32)
function randomPreimage32() {
  return web3.utils.randomHex(32); // 0x + 64 hex chars
}

function randomMessage() {
  return web3.utils.randomHex(64);
}

function extractContractId(receipt) {
  if (!receipt || !receipt.logs) return null;
  for (const l of receipt.logs) {
    if (l.args && l.args.contractId) return l.args.contractId;
  }
  return null;
}

/* ───────────── Main ───────────── */

module.exports = async function (callback) {
  try {
    fs.writeFileSync(
      LOG_PATH,
      `HashedTimelockLog 10-test run @ ${new Date().toISOString()}\n\n`,
      { encoding: "utf8" },
    );

    const accounts = await web3.eth.getAccounts();
    const sender = accounts[0];
    const receiver = accounts[1];

    logLine(`Using sender:   ${sender}`);
    logLine(`Using receiver: ${receiver}`);

    const htlc = await HashedTimelockLog.deployed();
    logLine(`HashedTimelockLog deployed at: ${htlc.address}`);

    const FUTURE_BUFFER_SECONDS = 300; // 5 minutes
    const STAGGER_SECONDS = 2;

    for (let i = 1; i <= 10; i++) {
      logLine(`\n=== TEST ${i}/10 ===`);

      const now = await chainNow();
      const timelock = now + FUTURE_BUFFER_SECONDS + i * STAGGER_SECONDS;

      // 32B CID-digest preimage and commitment
      const preimage32 = randomPreimage32();
      const hashlock = sha256OfBytes32Hex(preimage32);

      const message = randomMessage();
      const messageHash = web3.utils.keccak256(message);

      logLine(`preimage(32B): ${preimage32}`);
      logLine(`hashlock (sha256(preimage32)): ${hashlock}`);
      logLine(`messageHash: ${messageHash}`);
      logLine(`timelock(unix): ${timelock} (chainNow=${now})`);

      /* ---- CREATE ---- */
      const createTx = await htlc.newContract(
        receiver,
        hashlock,
        messageHash,
        timelock,
        { from: sender },
      );

      const contractId = extractContractId(createTx.receipt);
      logLine(`create tx: ${createTx.tx}`);
      logLine(`create gasUsed: ${createTx.receipt.gasUsed}`);
      logLine(
        `contractId: ${contractId ? contractId.toString() : "NOT_FOUND"}`,
      );

      if (!contractId) {
        logLine(`SKIP: could not extract contractId`);
        continue;
      }

      /* ---- REVEAL / WITHDRAW ---- */
      const withdrawTx = await htlc.withdraw(contractId, preimage32, {
        from: receiver,
      });
      logLine(`withdraw tx: ${withdrawTx.tx}`);
      logLine(`withdraw gasUsed: ${withdrawTx.receipt.gasUsed}`);

      /* ---- VERIFY ---- */
      const verifyTx = await htlc.verifyLog(contractId, message, {
        from: receiver,
      });
      logLine(`verify tx: ${verifyTx.tx}`);
      logLine(`verify gasUsed: ${verifyTx.receipt.gasUsed}`);

      /* ---- STATE ---- */
      const c = await htlc.getContract(contractId);
      logLine(
        `state: withdrawn=${c.withdrawn} refunded=${c.refunded} verified=${c.verified}`,
      );
    }

    logLine(`\nAll 10 tests completed successfully.`);
    logLine(`Log written to: ${LOG_PATH}`);
    callback();
  } catch (err) {
    console.error(err);
    callback(err);
  }
};
