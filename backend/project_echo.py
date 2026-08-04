"""
PROJECT ECHO 🔊
The Intelligence Gatherer (PsyOps V1)

Actively scrapes the web (RSS, News) for sentiment surrounding the tokens in our universe.
Runs the headlines through our NLP SentimentAnalyzer and injects the 'Conviction Bias' 
directly into the LGNN Brain.
"""

import asyncio
import logging
import feedparser
import re
from backend.services.sentiment_analyzer import get_sentiment_analyzer
from backend.services.brain import get_engine

logger = logging.getLogger("ProjectEcho")

class EchoGatherer:
    def __init__(self):
        self.analyzer = get_sentiment_analyzer()
        self.brain = get_engine()
        # Fallback RSS if we don't have CryptoPanic API
        self.rss_sources = [
            "https://cointelegraph.com/rss",
            "https://www.coindesk.com/arc/outboundfeeds/rss/"
        ]

    async def scan_market_pulse(self):
        """Scans global crypto news feeds and maps mentions to our universe."""
        logger.info("[ECHO] 📡 Scanning global intelligence frequencies...")
        
        # Get active universe symbols
        try:
            from backend.services.execution import get_execution_engine
            exec_engine = get_execution_engine()
            symbols = exec_engine.SYMBOLS
        except Exception:
            symbols = ["BTCUSDC", "ETHUSDC", "SOLUSDC"]
            
        # Clean symbols to base names (e.g. BTCUSDC -> BTC)
        base_coins = {sym: sym.replace("USDC", "").replace("USDT", "") for sym in symbols}
        coin_scores = {sym: [] for sym in symbols}
        
        # Name mapping for common coins
        full_names = {
            'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'DOGE': 'dogecoin',
            'ADA': 'cardano', 'XRP': 'ripple', 'AVAX': 'avalanche', 'LINK': 'chainlink',
            'MATIC': 'polygon', 'DOT': 'polkadot', 'UNI': 'uniswap', 'LTC': 'litecoin',
            'ATOM': 'cosmos', 'XLM': 'stellar', 'ALGO': 'algorand', 'NEAR': 'near',
            'APE': 'apecoin', 'ARB': 'arbitrum', 'OP': 'optimism', 'SUI': 'sui',
            'APT': 'aptos', 'INJ': 'injective', 'RNDR': 'render', 'FIL': 'filecoin',
            'LDO': 'lido'
        }

        # Parse feeds and analyze via Groq LLM (Blocking I/O wrapped in thread)
        def fetch_and_analyze():
            import os
            import requests
            
            all_entries = []
            
            # 1. Fetch from standard RSS feeds
            for url in self.rss_sources:
                try:
                    feed = feedparser.parse(url)
                    all_entries.extend(feed.entries)
                except Exception as e:
                    logger.warning(f"[ECHO] ⚠️ Feed {url} offline: {e}")
                    
            # 2. Fetch from CryptoPanic API (The Social Siphon)
            cryptopanic_key = os.getenv("CRYPTOPANIC_API_KEY", "")
            if cryptopanic_key:
                try:
                    cp_url = f"https://cryptopanic.com/api/v1/posts/?auth_token={cryptopanic_key}&kind=news&filter=important"
                    cp_resp = requests.get(cp_url, timeout=5)
                    if cp_resp.status_code == 200:
                        cp_data = cp_resp.json()
                        for post in cp_data.get('results', []):
                            # Map CryptoPanic fields to pseudo-RSS fields
                            all_entries.append({
                                'title': post.get('title', ''),
                                'summary': f"Source: {post.get('domain', 'CryptoPanic')} - Hype/Panic detected."
                            })
                        logger.info(f"[ECHO] 🌪️ Siphoned {len(cp_data.get('results', []))} viral headlines from CryptoPanic.")
                except Exception as e:
                    logger.warning(f"[ECHO] ⚠️ CryptoPanic Siphon failed: {e}")
                    
            if not all_entries:
                return {}

            import os
            import requests
            import json
            groq_key = os.getenv("GROQ_API_KEY", "")
            
            # If no key, fail gracefully
            if not groq_key:
                logger.error("[ECHO] GROQ_API_KEY not found. LLM disabled.")
                return {}

            # Gather texts
            news_texts = []
            # Sort by whatever order they came in, but CryptoPanic was appended last.
            # We want a mix. Let's just take the first 40 total to fit in context.
            for entry in all_entries[:40]: 
                title = entry.get('title', '')
                summary = entry.get('summary', '')
                clean_summary = re.sub(r'<[^>]+>', '', summary)
                news_texts.append(f"Title: {title} | Snippet: {clean_summary[:150]}")

            prompt = (
                "You are an elite crypto sentiment analyzer. Analyze the following news headlines.\n"
                "Extract the sentiment for specific cryptocurrencies mentioned. "
                "Respond ONLY in valid JSON format mapping the coin's base ticker (e.g. BTC, ETH, SOL, XRP) "
                "to a float score between -1.0 (very bearish) and 1.0 (very bullish). "
                "Do not include markdown blocks or any other text, just the raw JSON dict.\n"
                "News:\n" + "\n".join(news_texts)
            )

            try:
                headers = {
                    "Authorization": f"Bearer {groq_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": "llama-3.1-8b-instant",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.0
                }
                resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=10)
                
                if resp.status_code == 200:
                    content = resp.json()['choices'][0]['message']['content'].strip()
                    # Strip markdown if LLM disobeyed
                    if content.startswith('```'):
                        content = content.split('\n', 1)[1].rsplit('\n', 1)[0]
                        if content.startswith('json'):
                            content = content[4:].strip()
                            
                    scores_dict = json.loads(content)
                    return scores_dict
                else:
                    logger.error(f"[ECHO] Groq API error: {resp.text}")
                    return {}
            except Exception as e:
                logger.error(f"[ECHO] LLM Analysis failed: {e}")
                return {}

        llm_scores = await asyncio.to_thread(fetch_and_analyze)
        
        # Inject into Brain
        updates = 0
        for ticker, score in llm_scores.items():
            sym = f"{ticker}USDC"
            if sym in symbols:
                try:
                    score_val = float(score)
                    import math
                    boosted_score = math.tanh(score_val * 2.0)
                    
                    if hasattr(self.brain, 'ingest_sentiment'):
                        self.brain.ingest_sentiment(sym, boosted_score)
                        updates += 1
                        
                    if abs(boosted_score) > 0.3:
                        direction = "🐂 BULLISH" if boosted_score > 0 else "🐻 BEARISH"
                        logger.info(f"[ECHO-LLM] 🧠 {sym} Narrative detected: {direction} ({boosted_score:+.2f})")
                        
                        try:
                            from backend.routers.stream import frontend_manager
                            payload = {
                                "type": "ECHO_NARRATIVE",
                                "payload": {
                                    "symbol": sym,
                                    "direction": direction,
                                    "score": boosted_score,
                                    "timestamp": __import__('time').time()
                                }
                            }
                            await frontend_manager.broadcast(payload)
                        except Exception as e:
                            logger.error(f"[ECHO] Broadcast failed: {e}")
                except ValueError:
                    pass

        logger.info(f"[ECHO] 📡 Scan complete. Injected sentiment for {updates} targets.")


async def run_echo_loop():
    """Background Daemon for Project Echo."""
    await asyncio.sleep(30) # Warmup delay
    gatherer = EchoGatherer()
    
    while True:
        try:
            await gatherer.scan_market_pulse()
        except Exception as e:
            logger.error(f"[ECHO] Core fault: {e}")
            
        await asyncio.sleep(600) # Scan every 10 minutes
