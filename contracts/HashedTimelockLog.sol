// SPDX-License-Identifier: MIT
pragma solidity ^0.5.0;

/**
 * Logging-only HTLC (32-byte CID-digest style).
 *
 */
contract HashedTimelockLog {


    event LogHTLCNew(
        bytes32 indexed contractId,
        address indexed sender,
        address indexed receiver,
        bytes32 hashlock,
        bytes32 messageHash,
        uint timelock
    );

    event LogVerified(bytes32 indexed contractId);


    struct LockContract {
        address sender;
        address receiver;
        bytes32 hashlock;      // sha256(abi.encodePacked(preimage32))
        bytes32 messageHash;   // keccak256(message)
        uint timelock;
        bool verified;
    }

    mapping (bytes32 => LockContract) internal contracts;


    modifier futureTimelock(uint _time) {
        require(_time > now, "timelock time must be in the future");
        _;
    }

    modifier contractExists(bytes32 _contractId) {
        require(contracts[_contractId].sender != address(0), "contract does not exist");
        _;
    }

    modifier notVerified(bytes32 _contractId) {
        require(!contracts[_contractId].verified, "already verified");
        _;
    }


    function newContract(
        address _receiver,
        bytes32 _hashlock,
        bytes32 _messageHash,
        uint _timelock
    )
        external
        futureTimelock(_timelock)
        returns (bytes32 contractId)
    {
        require(_receiver != address(0), "receiver=0");

        contractId = sha256(
            abi.encodePacked(
                msg.sender,
                _receiver,
                _hashlock,
                _messageHash,
                _timelock
            )
        );

        require(contracts[contractId].sender == address(0), "contract exists");

        contracts[contractId] = LockContract(
            msg.sender,
            _receiver,
            _hashlock,
            _messageHash,
            _timelock,
            false
        );

        emit LogHTLCNew(
            contractId,
            msg.sender,
            _receiver,
            _hashlock,
            _messageHash,
            _timelock
        );
    }


    function verifyLog(bytes32 _contractId, bytes calldata _message)
        external
        contractExists(_contractId)
        notVerified(_contractId)
        returns (bool)
    {
        require(msg.sender == contracts[_contractId].receiver, "only receiver");

        require(
            keccak256(_message) == contracts[_contractId].messageHash,
            "message hash mismatch"
        );

        contracts[_contractId].verified = true;
        emit LogVerified(_contractId);
        return true;
    }


    function getContract(bytes32 _contractId)
        external
        view
        returns (
            address sender,
            address receiver,
            bytes32 hashlock,
            bytes32 messageHash,
            uint timelock,
            bool verified
        )
    {
        LockContract storage c = contracts[_contractId];
        return (
            c.sender,
            c.receiver,
            c.hashlock,
            c.messageHash,
            c.timelock,
            c.verified
        );
    }
}

