const HashedTimelock = artifacts.require("HashedTimelock");
const EllipticCurve = artifacts.require("EllipticCurve");
const HashedTimelockLog = artifacts.require("HashedTimelockLog");
const CIDBatchLog = artifacts.require("CIDBatchLog");
module.exports = function (deployer) {
  deployer.deploy(HashedTimelock);
  deployer.deploy(CIDBatchLog);
  deployer.deploy(HashedTimelockLog);
  deployer.deploy(EllipticCurve);
};
