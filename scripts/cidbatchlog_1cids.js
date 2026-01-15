const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CIDBatchLog = artifacts.require("CIDBatchLog");

const LOG_PATH = path.join(__dirname, "..", "cidbatchlog_1cids.log");

/* ───────────────── Helpers ───────────────── */

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  fs.appendFileSync(LOG_PATH, msg + "\n");
}

async function chainNow() {
  const b = await web3.eth.getBlock("latest");
  return Number(b.timestamp);
}

function randomCID32() {
  return web3.utils.randomHex(32);
}

function sha256PackedCIDs(cids) {
  // Matches Solidity: sha256(abi.encodePacked(uint256(len), cids))
  const lenBuf = Buffer.alloc(32);
  lenBuf.writeBigUInt64BE(BigInt(cids.length), 24);

  const cidBufs = cids.map((c) => Buffer.from(c.slice(2), "hex"));
  const packed = Buffer.concat([lenBuf, ...cidBufs]);

  return "0x" + crypto.createHash("sha256").update(packed).digest("hex");
}

function extractBatchId(receipt) {
  for (const l of receipt.logs || []) {
    if (l.args && l.args.batchId) return l.args.batchId;
  }
  return null;
}

/* ───────────────── Script ───────────────── */

module.exports = async function (callback) {
  try {
    fs.writeFileSync(
      LOG_PATH,
      `CIDBatchLog – 1 CID test\nStarted: ${new Date().toISOString()}\n\n`,
    );

    const accounts = await web3.eth.getAccounts();
    const sender = accounts[0];
    const receiver = accounts[1];

    log(`Sender:   ${sender}`);
    log(`Receiver: ${receiver}`);

    const contract = await CIDBatchLog.deployed();
    log(`Contract: ${contract.address}`);

    /* ───────────── Generate 1 CIDs ───────────── */

    const CID_COUNT = 1;
    const cids = Array.from({ length: CID_COUNT }, randomCID32);

    log(`Generated ${CID_COUNT} CIDs`);
    cids.forEach((cid, i) => log(`CID[${i}]: ${cid}`));

    const aggregateLocal = sha256PackedCIDs(cids);
    log(`Local aggregateHash: ${aggregateLocal}`);

    const message = web3.utils.randomHex(64);
    const messageHash = web3.utils.keccak256(message);

    const now = await chainNow();
    const timelock = now + 600;

    /* ───────────── CREATE BATCH ───────────── */

    log("Creating batch...");
    const createTx = await contract.createBatch(
      receiver,
      cids,
      messageHash,
      timelock,
      { from: sender },
    );

    const batchId = extractBatchId(createTx.receipt);
    log(`batchId: ${batchId}`);
    log(`create gasUsed: ${createTx.receipt.gasUsed}`);

    /* ───────────── RELEASE ───────────── */

    log("Releasing aggregate...");
    const releaseTx = await contract.releaseAggregate(batchId, {
      from: sender,
    });
    log(`release gasUsed: ${releaseTx.receipt.gasUsed}`);

    /* ───────────── VERIFY CIDS ───────────── */

    log("Verifying CIDs...");
    const verifyTx = await contract.verifyCIDs(batchId, cids, {
      from: receiver,
    });
    log(`verifyCIDs gasUsed: ${verifyTx.receipt.gasUsed}`);

    /* ───────────── VERIFY MESSAGE ───────────── */

    log("Verifying message...");
    const verifyMsgTx = await contract.verifyMessage(batchId, message, {
      from: receiver,
    });
    log(`verifyMessage gasUsed: ${verifyMsgTx.receipt.gasUsed}`);

    /* ───────────── FINAL STATE ───────────── */

    const b = await contract.getBatch(batchId);
    log(
      `Final state: released=${b.released} verified=${b.verified} cidCount=${b.cidCount}`,
    );

    log("\nTest complete.");
    callback();
  } catch (err) {
    console.error(err);
    callback(err);
  }
};
