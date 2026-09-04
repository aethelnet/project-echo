import re

with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/jupiter_execution.py', 'r') as f:
    code = f.read()

old_import = "from solders.system_program import TransferParams, transfer"
new_import = "from solders.system_program import TransferParams, transfer\n                    from solders.keypair import Keypair"
code = code.replace(old_import, new_import)

old_bundle = "                    # Fire bundle to all 5 global Jito block engines in parallel\n                    bundle_result = await self.jito.broadcast_bundle([signed_swap_tx_encoded, jito_tip_tx_encoded])"

new_bundle = """                    # --- ZERO-KNOWLEDGE STEALTH ROUTE: SYBIL NOISE INJECTION ---
                    print(f"[STEALTH] 🥷 Generating 3 Ghost-Transactions (Sybil Decoys) to confuse MEV copy-bots...")
                    decoy_txs = []
                    for _ in range(3):
                        ghost_kp = Keypair()
                        ghost_ix = transfer(
                            TransferParams(
                                from_pubkey=self.keypair.pubkey(),
                                to_pubkey=ghost_kp.pubkey(),
                                lamports=1 # Dust
                            )
                        )
                        ghost_msg = MessageV0.try_compile(
                            self.keypair.pubkey(),
                            [ghost_ix],
                            [],
                            recent_blockhash
                        )
                        ghost_tx = VersionedTransaction(ghost_msg, [self.keypair])
                        decoy_txs.append(base58.b58encode(bytes(ghost_tx)).decode("utf-8"))
                        
                    # Bundle Structure: Swap -> Ghost1 -> Ghost2 -> Ghost3 -> Tip
                    bundle_transactions = [signed_swap_tx_encoded] + decoy_txs + [jito_tip_tx_encoded]
                    
                    # Fire bundle to all 5 global Jito block engines in parallel
                    bundle_result = await self.jito.broadcast_bundle(bundle_transactions)"""

code = code.replace(old_bundle, new_bundle)

with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/jupiter_execution.py', 'w') as f:
    f.write(code)

print("Stealth Route Injected!")
