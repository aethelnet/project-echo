# Patch Sniper
with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/hyperliquid_sniper.py', 'r') as f:
    sniper = f.read()

if "from sovereign_trading_engine.execution.telegram_notifier import TelegramHQ" not in sniper:
    sniper = sniper.replace(
        "from sovereign_trading_engine.execution.hyperliquid_client import HyperliquidClient",
        "from sovereign_trading_engine.execution.hyperliquid_client import HyperliquidClient\nfrom sovereign_trading_engine.execution.telegram_notifier import TelegramHQ"
    )
    
    sniper = sniper.replace(
        "logger.info(f\"🚀 INITIALIZING HYPERLIQUID MOMENTUM SNIPER (Targeting: {len(TARGET_COINS)} Coins)\")",
        "self.hq = TelegramHQ()\n        logger.info(f\"🚀 INITIALIZING HYPERLIQUID MOMENTUM SNIPER (Targeting: {len(TARGET_COINS)} Coins)\")"
    )
    
    sniper = sniper.replace(
        "logger.info(f\"✅ LONG SUCCESSFUL. Trailing Stop-Loss activated at -1.0%.\")",
        "logger.info(f\"✅ LONG SUCCESSFUL. Trailing Stop-Loss activated at -1.0%.\")\n        self.hq.alert_trade(coin, 'LONG', POSITION_SIZE_USD, current_price)"
    )
    
    sniper = sniper.replace(
        "logger.info(f\"✅ SHORT SUCCESSFUL. Profit-Taker set at +2.0%, Trailing Stop at -0.5%.\")",
        "logger.info(f\"✅ SHORT SUCCESSFUL. Profit-Taker set at +2.0%, Trailing Stop at -0.5%.\")\n        self.hq.alert_trade(coin, 'SHORT', POSITION_SIZE_USD * 2.0, current_price)"
    )
    
    with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/hyperliquid_sniper.py', 'w') as f:
        f.write(sniper)


# Patch Auto-Compounder
with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/auto_compounder.py', 'r') as f:
    compounder = f.read()

if "from sovereign_trading_engine.execution.telegram_notifier import TelegramHQ" not in compounder:
    compounder = compounder.replace(
        "from sovereign_trading_engine.execution.hyperliquid_client import HyperliquidClient",
        "from sovereign_trading_engine.execution.hyperliquid_client import HyperliquidClient\nfrom sovereign_trading_engine.execution.telegram_notifier import TelegramHQ"
    )
    
    compounder = compounder.replace(
        "self.sweep_threshold = sweep_threshold",
        "self.sweep_threshold = sweep_threshold\n        self.hq = TelegramHQ()"
    )
    
    compounder = compounder.replace(
        "logging.info(f\"🔒 SWEEP SUCCESSFUL! ${sweep_amount:.2f} securely locked in yield-bearing vault. Base capital reset to ${self.base_capital:.2f}.\")",
        "logging.info(f\"🔒 SWEEP SUCCESSFUL! ${sweep_amount:.2f} securely locked in yield-bearing vault. Base capital reset to ${self.base_capital:.2f}.\")\n            self.hq.alert_sweep(sweep_amount)"
    )
    
    with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/auto_compounder.py', 'w') as f:
        f.write(compounder)

print("Telegram integration complete!")
