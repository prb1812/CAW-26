// Local security test for CampusAchievement.
// Run: npx hardhat --config hardhat.config.cjs run scripts/security-test.cjs
const {ethers}=require("hardhat");
const ok=(n)=>console.log("PASS",n);
async function rev(p,frag,n){try{await p;console.log("FAIL (no revert)",n);process.exitCode=1}catch(e){const m=(e.message||"")+(e.shortMessage||"");if(m.includes(frag))ok(n);else{console.log("FAIL wrong error",n,m.slice(0,150));process.exitCode=1}}}
(async()=>{
 const [admin,student,other,attacker]=await ethers.getSigners();
 const F=await ethers.getContractFactory("CampusAchievement",admin);
 const c=await F.deploy(admin.address);await c.waitForDeployment();
 const H=(s)=>ethers.sha256(ethers.toUtf8Bytes(s));
 const args=(to,h)=>[to,"ipfs://x","Title","certificate","SVKM","Event",h];
 const digest=async(to,h)=>c.voucherDigest(to,h,"Title","certificate","SVKM","Event");
 const sign=async(s,to,h)=>s.signMessage(ethers.getBytes(await digest(to,h)));

 // 1 unauthorised mint
 await rev(c.connect(attacker).mintAchievement(...args(attacker.address,H("a")),"0x"),"","attacker mint without voucher reverts");
 // 2 voucher signed by non-minter
 await rev(c.connect(attacker).mintAchievement(...args(attacker.address,H("a")),await sign(attacker,attacker.address,H("a"))),"Invalid issuer signature","voucher from non-minter rejected");
 // 3 valid voucher, submitted by student
 const h1=H("cert1"); const sig=await sign(admin,student.address,h1);
 await (await c.connect(student).mintAchievement(...args(student.address,h1),sig)).wait();
 ok("student claims with admin voucher");
 // 4 voucher can't be reused / redirected
 await rev(c.connect(attacker).mintAchievement(...args(student.address,h1),sig),"Already issued","voucher replay blocked");
 const h2=H("cert2");const sig2=await sign(admin,student.address,h2);
 await rev(c.connect(attacker).mintAchievement(...args(attacker.address,h2),sig2),"Invalid issuer signature","voucher cannot be redirected to another wallet");
 // 5 verifyHash
 let v=await c.verifyHash(h1); if(v[0]&&!v[1]&&v[2]==1n&&v[3]==student.address)ok("verifyHash valid");else{console.log("FAIL verifyHash",v);process.exitCode=1}
 v=await c.verifyHash(H("tampered")); if(!v[0]&&!v[1]&&v[2]==0n)ok("verifyHash unknown/tampered");else{console.log("FAIL",v);process.exitCode=1}
 // 6 soulbound
 await rev(c.connect(student).transferFrom(student.address,other.address,1),"Soulbound","transfer blocked");
 await rev(c.connect(student)["safeTransferFrom(address,address,uint256)"](student.address,other.address,1),"Soulbound","safeTransfer blocked");
 await rev(c.connect(student).approve(other.address,1),"approvals disabled","approve blocked");
 await rev(c.connect(student).setApprovalForAll(other.address,true),"approvals disabled","setApprovalForAll blocked");
 if(await c.locked(1)&&await c.supportsInterface("0xb45a3c0e"))ok("ERC-5192 locked()+interface");else process.exitCode=1;
 // 7 revoke by non-admin, then admin
 await rev(c.connect(attacker).revokeByHash(h1,"x"),"AccessControl","non-admin cannot revoke");
 await (await c.revokeByHash(h1,"issued in error")).wait();
 v=await c.verifyHash(h1); if(!v[0]&&v[1]&&v[2]==1n)ok("verifyHash reports revoked");else{console.log("FAIL",v);process.exitCode=1}
 // 8 cancel before claim
 const h3=H("cert3");const sig3=await sign(admin,student.address,h3);
 await (await c.revokeByHash(h3,"cancelled before claim")).wait();
 await rev(c.connect(student).mintAchievement(...args(student.address,h3),sig3),"Certificate revoked","revoked-before-claim voucher unusable");
 // 9 batchMint
 await rev(c.connect(attacker).batchMint([{to:student.address,tokenURI:"u",title:"t",achievementType:"c",issuerName:"i",eventName:"e",fileHash:H("b1")}]),"AccessControl","batchMint needs minter");
 const items=[1,2,3].map(i=>({to:student.address,tokenURI:"u",title:"t"+i,achievementType:"certificate",issuerName:"i",eventName:"e",fileHash:H("bulk"+i)}));
 await (await c.batchMint(items)).wait(); if((await c.totalMinted())==4n)ok("batchMint 3 in one tx");else process.exitCode=1;
 console.log("done");
})();
