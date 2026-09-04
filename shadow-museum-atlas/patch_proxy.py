import re

# 1. Update .env
with open('/home/nikahrlyn/auratic-systems-prime/backend_clean/.env', 'a') as f:
    f.write('\n# --- PHANTOM PROXY NETWORK ---\n')
    f.write('OXYLABS_PROXY_BASE="http://customer-auratic_prime-sessid-{}:stealth_k3y@pr.oxylabs.io:7777"\n')

# 2. Patch jupiter_execution.py
with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/jupiter_execution.py', 'r') as f:
    code = f.read()

old_proxy_class = """class StealthProxyRotator:
    \"\"\"
    Cycles through a pool of residential proxies or Tor nodes to evade 
    Cloudflare Datacenter-IP blocking on Jupiter/Solana RPCs.
    \"\"\"
    def __init__(self):
        # In production, these would be loaded from .env (e.g., BrightData, Oxylabs, or local Tor SOCKS5)
        self.proxy_pool = []
        self.use_proxies = len(self.proxy_pool) > 0

    def get_session(self):
        \"\"\"Returns a requests Session configured with a random proxy if available.\"\"\"
        session = requests.Session()
        if self.use_proxies:
            proxy = random.choice(self.proxy_pool)
            session.proxies = {"http": proxy, "https": proxy}
            print(f"[STEALTH] Routing traffic through proxy shield: {proxy.split('@')[-1] if '@' in proxy else proxy}")
        return session"""

new_proxy_class = """class StealthProxyRotator:
    \"\"\"
    Dynamically generates Phantom Sessions using Oxylabs/BrightData Residential IP rotation.
    Ensures every Jupiter API request and RPC call originates from a completely unique IP.
    \"\"\"
    def __init__(self):
        from dotenv import load_dotenv
        import os
        load_dotenv("/home/nikahrlyn/auratic-systems-prime/backend_clean/.env")
        
        self.proxy_base = os.environ.get("OXYLABS_PROXY_BASE")
        self.use_proxies = self.proxy_base is not None

    def get_session(self):
        \"\"\"Returns a requests Session bound to a fresh, randomized residential IP exit node.\"\"\"
        session = requests.Session()
        if self.use_proxies:
            # Generate a random 8-character session ID to force the provider to assign a new IP
            session_id = os.urandom(4).hex()
            dynamic_proxy = self.proxy_base.format(session_id)
            
            session.proxies = {"http": dynamic_proxy, "https": dynamic_proxy}
            
            # Mask the User-Agent so we don't look like a Python bot
            session.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
            })
            
            # Print without exposing credentials
            clean_host = dynamic_proxy.split('@')[-1]
            print(f"[PHANTOM PROXY] 👻 Request obfuscated via exit node: {clean_host} (SessID: {session_id})")
        return session"""

code = code.replace(old_proxy_class, new_proxy_class)

with open('/home/nikahrlyn/auratic-systems-prime/sovereign_trading_engine/execution/jupiter_execution.py', 'w') as f:
    f.write(code)

print("Phantom Proxy Network activated!")
