const d = require('../artifacts/contracts/CipherPayFHE.sol/CipherPayFHE.json');
const abi = d.abi.filter(a => a.type !== 'error');
console.log(JSON.stringify(abi, null, 2));
