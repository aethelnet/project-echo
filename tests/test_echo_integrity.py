import base64
import hashlib
import math
import os
import tempfile
import unittest
from unittest.mock import patch

import torch
from fastapi.testclient import TestClient

import serve_graph_api
from backend.echo_lgnn_tensor import (
    EchoProphitNet,
    binary_shannon_entropy,
    liquid_entropy_loss,
)


class TestEchoAuthAndHtpasswd(unittest.TestCase):
    def test_htpasswd_verification_formats_on_modern_python(self):
        """Verifies {SHA}, sha256$, and POSIX $6$ crypt hashes work on Python 3.13/3.14+."""
        pw = "SovereignRestitution2026!"

        # 1. {SHA} format
        sha_digest = base64.b64encode(hashlib.sha1(pw.encode("utf-8")).digest()).decode("ascii")
        sha_entry = f"{{SHA}}{sha_digest}"
        self.assertTrue(serve_graph_api._verify_htpasswd_hash(pw, sha_entry))
        self.assertFalse(serve_graph_api._verify_htpasswd_hash("wrong-password", sha_entry))

        # 2. sha256$<salt>$<hex> format
        salt = "benin1897"
        sha256_hex = hashlib.sha256((salt + pw).encode("utf-8")).hexdigest()
        sha256_entry = f"sha256${salt}${sha256_hex}"
        self.assertTrue(serve_graph_api._verify_htpasswd_hash(pw, sha256_entry))
        self.assertFalse(serve_graph_api._verify_htpasswd_hash("wrong-password", sha256_entry))

        # 3. POSIX $6$ (SHA-512 crypt via libcrypt.so.2)
        posix_hash = serve_graph_api._posix_crypt(pw, "$6$rounds=5000$saltsalt$")
        if posix_hash is not None:
            self.assertTrue( posix_hash.startswith("$6$"))
            self.assertTrue(serve_graph_api._verify_htpasswd_hash(pw, posix_hash))
            self.assertFalse(serve_graph_api._verify_htpasswd_hash("wrong-password", posix_hash))

    def test_check_credentials_with_htpasswd_file_and_env_key(self):
        """Verifies file-backed .htpasswd_echo and ECHO_RESEARCHER_KEY authentication."""
        pw = "NgonnsoArchiveKey"
        sha_digest = base64.b64encode(hashlib.sha1(pw.encode("utf-8")).digest()).decode("ascii")
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as tmp:
            tmp.write(f"# Researcher credentials\nmarianne:{{SHA}}{sha_digest}\n")
            ht_path = tmp.name

        try:
            with patch.object(serve_graph_api, "HTPASSWD_FILE", ht_path), \
                 patch.object(serve_graph_api, "ECHO_RESEARCHER_KEY", "env-master-key"):
                # Valid htpasswd user + password
                self.assertTrue(serve_graph_api.check_credentials("marianne", pw))
                self.assertTrue(serve_graph_api.check_credentials("MARIANNE", pw))
                # Invalid password or unknown user
                self.assertFalse(serve_graph_api.check_credentials("marianne", "bad-pw"))
                self.assertFalse(serve_graph_api.check_credentials("intruder", pw))
                # Valid env master key
                self.assertTrue(serve_graph_api.check_credentials("marianne", "env-master-key"))
                self.assertFalse(serve_graph_api.check_credentials("marianne", ""))
        finally:
            if os.path.exists(ht_path):
                os.remove(ht_path)

    def test_dual_mode_session_and_login_endpoints(self):
        """Verifies Guest vs Researcher isolation on /api/auth/session and /api/auth/login."""
        client = TestClient(serve_graph_api.app)
        with patch.object(serve_graph_api, "ECHO_RESEARCHER_KEY", "test-researcher-secret"):
            # 1. Unauthenticated guest session
            res_guest = client.get("/api/auth/session")
            self.assertEqual(res_guest.status_code, 200)
            self.assertEqual(res_guest.json()["role"], "GUEST")
            self.assertFalse(res_guest.json()["authenticated"])

            # 2. Failed login with wrong password
            res_bad = client.post("/api/auth/login", json={"username": "marianne", "password": "wrong"})
            self.assertEqual(res_bad.status_code, 401)

            # 3. Successful login with valid key
            res_ok = client.post("/api/auth/login", json={"username": "marianne", "password": "test-researcher-secret"})
            self.assertEqual(res_ok.status_code, 200)
            self.assertEqual(res_ok.json()["role"], "RESEARCHER")

            # 4. Authenticated session via Bearer header
            res_auth = client.get(
                "/api/auth/session",
                headers={"Authorization": "Bearer test-researcher-secret"}
            )
            self.assertEqual(res_auth.status_code, 200)
            self.assertTrue(res_auth.json()["authenticated"])
            self.assertEqual(res_auth.json()["role"], "RESEARCHER")


class TestEchoTensorMath(unittest.TestCase):
    def test_binary_shannon_entropy_invariants(self):
        """Verifies non-negativity, maximum at p=0.5 (ln 2), and symmetry H(p) == H(1-p)."""
        p_half = torch.tensor([[0.5, 0.5, 0.5]])
        h_half = binary_shannon_entropy(p_half)
        self.assertTrue(torch.allclose(h_half, torch.full_like(p_half, math.log(2.0)), atol=1e-6))

        # Symmetry H(p) == H(1 - p) and strict non-negativity
        p_vals = torch.tensor([0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99])
        h_p = binary_shannon_entropy(p_vals)
        h_sym = binary_shannon_entropy(1.0 - p_vals)
        self.assertTrue(torch.all(h_p >= 0.0))
        self.assertTrue(torch.allclose(h_p, h_sym, atol=1e-6))

        # Extremes have near-zero entropy
        p_ext = torch.tensor([1e-6, 1.0 - 1e-6])
        self.assertLess(float(binary_shannon_entropy(p_ext).max().item()), 1e-4)

    def test_liquid_entropy_loss_penalizes_overconfidence(self):
        """Verifies overconfidence penalty is 0 at p=0.5 and strictly positive near 0 or 1."""
        target = torch.tensor([[0.5, 0.5, 0.5]])
        pred_uncertain = torch.tensor([[0.5, 0.5, 0.5]], requires_grad=True)
        loss_uncertain = liquid_entropy_loss(pred_uncertain, target, alpha=0.1)
        # At p=0.5 and target=0.5: MSE=0 and overconfidence_penalty = ln(2) - ln(2) = 0
        self.assertAlmostEqual(float(loss_uncertain.item()), 0.0, places=6)

        # At p=0.99 and target=0.99: MSE=0, but overconfidence penalty > 0
        target_conf = torch.tensor([[0.99, 0.99, 0.99]])
        pred_conf = torch.tensor([[0.99, 0.99, 0.99]], requires_grad=True)
        loss_conf = liquid_entropy_loss(pred_conf, target_conf, alpha=0.1)
        self.assertGreater(float(loss_conf.item()), 0.05)

        # Verify backward pass produces finite gradients
        model = EchoProphitNet(embedding_dim=32, hidden_dim=16)
        x = torch.randn(2, 32)
        y = torch.tensor([[1.0, 1.0, 1.0], [0.0, 0.0, 0.0]])
        out = model(x)
        self.assertEqual(out.shape, (2, 3))
        self.assertTrue(torch.all((out >= 0.0) & (out <= 1.0)))
        loss = liquid_entropy_loss(out, y)
        loss.backward()
        for param in model.parameters():
            self.assertIsNotNone(param.grad)
            self.assertTrue(torch.all(torch.isfinite(param.grad)))


if __name__ == "__main__":
    unittest.main()
