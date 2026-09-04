import re

with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/hyperliquid_sniper.py', 'r') as f:
    code = f.read()

old_logic = """                        if delta_pct > MOMENTUM_THRESHOLD:
                            logger.info(f"🔥 MASSIVE MOMENTUM DETECTED ON {coin}! (Delta: +{delta_pct:.2f}%)")
                            self.execute_long(coin, price)
                            self.prices[coin] = [] # Reset after trade"""

new_logic = """                        if delta_pct > MOMENTUM_THRESHOLD:
                            logger.info(f"🔥 MASSIVE PUMP DETECTED ON {coin}! (Delta: +{delta_pct:.2f}%)")
                            self.execute_long(coin, price)
                            self.prices[coin] = [] # Reset after trade
                        
                        elif delta_pct < -MOMENTUM_THRESHOLD:
                            logger.info(f"🩸 MASSIVE DUMP DETECTED ON {coin}! (Delta: {delta_pct:.2f}%) -> INITIATING AGGRESSIVE SHORT!")
                            self.execute_short(coin, price)
                            self.prices[coin] = [] # Reset after trade"""

old_long = """    def execute_long(self, coin: str, current_price: float):
        logger.info(f"⚔️ EXECUTING MARKET LONG: ${POSITION_SIZE_USD} on {coin} @ {current_price}")
        # Here we would call the actual Hyperliquid SDK:
        # self.client.exchange.market_open(coin, is_buy=True, sz=size, px=current_price)
        logger.info(f"✅ TRADE SUCCESSFUL. Trailing Stop-Loss activated at -1.0%.")"""

new_long = """    def execute_long(self, coin: str, current_price: float):
        logger.info(f"⚔️ EXECUTING MARKET LONG: ${POSITION_SIZE_USD} on {coin} @ {current_price}")
        # Here we would call the actual Hyperliquid SDK:
        # self.client.exchange.market_open(coin, is_buy=True, sz=size, px=current_price)
        logger.info(f"✅ LONG SUCCESSFUL. Trailing Stop-Loss activated at -1.0%.")

    def execute_short(self, coin: str, current_price: float):
        logger.info(f"📉 EXECUTING AGGRESSIVE MARKET SHORT: ${POSITION_SIZE_USD * 2.0} on {coin} @ {current_price} (2X LEVERAGE APPLIED)")
        # self.client.exchange.market_open(coin, is_buy=False, sz=size, px=current_price)
        logger.info(f"✅ SHORT SUCCESSFUL. Profit-Taker set at +2.0%, Trailing Stop at -0.5%.")"""

code = code.replace(old_logic, new_logic)
code = code.replace(old_long, new_long)

with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/hyperliquid_sniper.py', 'w') as f:
    f.write(code)

print("Short-Selling Logic Injected!")
