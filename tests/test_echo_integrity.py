import base64
import hashlib
import math
import os
import tempfile
import unittest
import zipfile
from io import BytesIO
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

        sha_digest = base64.b64encode(hashlib.sha1(pw.encode("utf-8")).digest()).decode("ascii")
        sha_entry = f"{{SHA}}{sha_digest}"
        self.assertTrue(serve_graph_api._verify_htpasswd_hash(pw, sha_entry))
        self.assertFalse(serve_graph_api._verify_htpasswd_hash("wrong-password", sha_entry))

        salt = "benin1897"
        sha256_hex = hashlib.sha256((salt + pw).encode("utf-8")).hexdigest()
        sha256_entry = f"sha256${salt}${sha256_hex}"
        self.assertTrue(serve_graph_api._verify_htpasswd_hash(pw, sha256_entry))
        self.assertFalse(serve_graph_api._verify_htpasswd_hash("wrong-password", sha256_entry))

        posix_hash = serve_graph_api._posix_crypt(pw, "$6$rounds=5000$saltsalt$")
        if posix_hash is not None:
            self.assertTrue(posix_hash.startswith("$6$"))
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
            with patch.object(serve_graph_api, "HTPASSWD_FILE", ht_path), patch.object(
                serve_graph_api, "ECHO_RESEARCHER_KEY", "env-master-key"
            ):
                self.assertTrue(serve_graph_api.check_credentials("marianne", pw))
                self.assertTrue(serve_graph_api.check_credentials("MARIANNE", pw))
                self.assertFalse(serve_graph_api.check_credentials("marianne", "bad-pw"))
                self.assertFalse(serve_graph_api.check_credentials("intruder", pw))
                self.assertTrue(serve_graph_api.check_credentials("marianne", "env-master-key"))
                self.assertFalse(serve_graph_api.check_credentials("marianne", ""))
        finally:
            if os.path.exists(ht_path):
                os.remove(ht_path)

    def test_dual_mode_session_and_login_endpoints(self):
        """Verifies Guest vs Researcher isolation on /api/auth/session and /api/auth/login."""
        client = TestClient(serve_graph_api.app)
        with patch.object(serve_graph_api, "ECHO_RESEARCHER_KEY", "test-researcher-secret"):
            res_guest = client.get("/api/auth/session")
            self.assertEqual(res_guest.status_code, 200)
            self.assertEqual(res_guest.json()["role"], "GUEST")
            self.assertFalse(res_guest.json()["authenticated"])

            res_bad = client.post("/api/auth/login", json={"username": "marianne", "password": "wrong"})
            self.assertEqual(res_bad.status_code, 401)

            res_ok = client.post("/api/auth/login", json={"username": "marianne", "password": "test-researcher-secret"})
            self.assertEqual(res_ok.status_code, 200)
            self.assertEqual(res_ok.json()["role"], "RESEARCHER")

            res_auth = client.get(
                "/api/auth/session",
                headers={"Authorization": "Bearer test-researcher-secret"},
            )
            self.assertEqual(res_auth.status_code, 200)
            self.assertTrue(res_auth.json()["authenticated"])
            self.assertEqual(res_auth.json()["role"], "RESEARCHER")


class TestEchoEmbeddedGraphAndDossiers(unittest.TestCase):
    def setUp(self):
        serve_graph_api.EMBEDDED_STORE.load_seed()
        self.client = TestClient(serve_graph_api.app)

    def test_embedded_seed_stats_and_forensic_endpoints(self):
        """Verifies full 2,223-node / 6,628-edge provenance graph runs without Neo4j Docker."""
        with patch.object(serve_graph_api, "is_neo4j_available", return_value=False):
            stats = self.client.get("/api/stats").json()
            self.assertTrue(stats["success"])
            self.assertEqual(stats["subjekte"], 2148)
            self.assertEqual(stats["akteure"], 60)
            self.assertEqual(stats["institutionen"], 8)
            self.assertEqual(stats["publikationen"], 7)
            self.assertEqual(stats["gesamt_kanten"], 6628)
            self.assertEqual(stats["contested_objekte"], 1999)
            self.assertEqual(stats["provenienz_luecken"], 83)

            ghosts = self.client.get("/api/ghosts").json()
            self.assertEqual(ghosts["ghost_count"], 2)

            contested = self.client.get("/api/contested").json()
            self.assertGreaterEqual(contested["contested_count"], 1999)

            suspicions = self.client.get("/api/suspicions").json()
            self.assertEqual(suspicions["total"], 37)

            pubs = self.client.get("/api/publications").json()
            self.assertEqual(pubs["total"], 7)

            g = self.client.get("/api/graph?limit=100&search=Zintgraff").json()
            self.assertTrue(g["success"])
            self.assertGreater(g["total_links"], 0)

            actor = self.client.get("/api/actors/Hans%20Glauning/summary")
            self.assertEqual(actor.status_code, 200)
            self.assertGreater(actor.json()["summary"]["raub_count"], 10)

            inst = self.client.get("/api/institutions/Linden-Museum%20Stuttgart/summary")
            self.assertEqual(inst.status_code, 200)
            self.assertGreater(inst.json()["summary"]["total_subjekte"], 100)

    def test_dossier_pdf_batch_zip_and_hlko_petition_pipeline(self):
        """Verifies court-ready PDF dossiers, route batch ZIP, and async HLKO petition package."""
        with patch.object(serve_graph_api, "is_neo4j_available", return_value=False):
            # 1. Single PDF dossier
            res_dos = self.client.post("/api/dossier/generate", json={"inventarnummer": "III C 15017"})
            self.assertEqual(res_dos.status_code, 200)
            dl_url = res_dos.json()["download_url"]
            pdf_bytes = self.client.get(dl_url).content
            self.assertTrue(pdf_bytes.startswith(b"%PDF-1."))

            # 2. Route-specific list batch ZIP
            res_batch = self.client.post(
                "/api/dossier/batch",
                json={
                    "entity_type": "list",
                    "entity_name": "Bafut_Route",
                    "inventarnummern": ["III C 15017", "R1001"],
                },
            )
            self.assertEqual(res_batch.status_code, 200)
            self.assertEqual(res_batch.json()["dossiers_packaged"], 2)

            # 3. Async HLKO diplomatic restitution package
            res_llm = self.client.post(
                "/api/petition/generate_llm",
                json={"institution": "Ethnologisches Museum Berlin", "community": "Nso"},
            )
            self.assertEqual(res_llm.status_code, 202)
            job_id = res_llm.json()["job_id"]
            st = self.client.get(f"/api/petition/status/{job_id}").json()
            self.assertEqual(st["status"], "completed")
            zip_bytes = self.client.get(st["result"]["download_zip_url"]).content
            with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
                names = zf.namelist()
                self.assertTrue(any(n.endswith(".pdf") for n in names))
                self.assertTrue(any(n.endswith("_Manifest.json") for n in names))

    def test_security_annotations_auth_and_download_traversal(self):
        """Verifies write endpoints enforce Researcher auth and download blocks path traversal."""
        with patch.object(serve_graph_api, "is_neo4j_available", return_value=False), patch.object(
            serve_graph_api, "ECHO_RESEARCHER_KEY", "sec-key-2026"
        ):
            # Unauthenticated annotation write must be rejected
            res_unauth = self.client.post(
                "/api/objects/R1001/annotations",
                json={"author": "Guest", "notes": "Unauthorized write"},
            )
            self.assertEqual(res_unauth.status_code, 401)

            # Authenticated annotation lifecycle succeeds
            hdrs = {"X-Researcher-Key": "sec-key-2026"}
            res_add = self.client.post(
                "/api/objects/R1001/annotations",
                headers=hdrs,
                json={"author": "Marianne", "notes": "Archivabgleich verifiziert", "tags": ["HLKO"]},
            )
            self.assertEqual(res_add.status_code, 200)
            ann_id = res_add.json()["annotation_id"]

            res_get = self.client.get("/api/objects/R1001/annotations").json()
            self.assertEqual(res_get["count"], 1)

            res_del = self.client.delete(f"/api/annotations/{ann_id}", headers=hdrs)
            self.assertEqual(res_del.status_code, 200)

            # Path traversal rejected
            res_trav = self.client.get("/api/dossier/download/..%2Fserve_graph_api.py")
            self.assertIn(res_trav.status_code, (400, 404))

    def test_global_multilingual_provenance_extraction(self):
        """Verifies universal DE/EN/FR provenance parser handles non-Cameroon & non-German archives."""
        from extract_provenance_triples import BatchProvenancePipeline

        pipe = BatchProvenancePipeline()

        # 1. English: Benin 1897 Punitive Expedition + British Museum + dynamic officer
        en_text = (
            "During the Benin Punitive Expedition of 1897, brass bronze plaque Af1897,0511.1 "
            "was looted from the Edo Court by Captain Arthur Beaumont under Admiral Sir Harry Rawson "
            "and subsequently donated to the British Museum in London."
        )
        en_triples = pipe.parse_text_page(12, en_text, "Benin_Catalogue_1898.pdf")
        en_invs = {t["target"]["id"] for t in en_triples if t["target"]["label"] == "Objekt"}
        en_insts = {t["target"]["id"] for t in en_triples if t["target"]["label"] == "Institution"}
        en_rels = {t["type"] for t in en_triples}
        self.assertIn("Af1897,0511.1", en_invs)
        self.assertIn("British Museum", en_insts)
        self.assertIn("RAUBTE", en_rels)
        self.assertIn("SCHENKTE", en_rels)  # Multigraph dissonance detected automatically!

        # 2. French: Dahomey 1892 + Musée du quai Branly
        fr_text = (
            "Lors de l'expédition punitive au Dahomey en 1892, le trône royal 71.1892.34.1 "
            "fut pillé à Abomey par le Général Alfred Dodds et déposé au Musée du quai Branly à Paris."
        )
        fr_triples = pipe.parse_text_page(4, fr_text, "Archives_Abomey.pdf")
        fr_insts = {t["target"]["id"] for t in fr_triples if t["target"]["label"] == "Institution"}
        self.assertIn("Musée du quai Branly", fr_insts)
        obj_props = [t["target"]["props"] for t in fr_triples if t["target"]["id"] == "71.1892.34.1"][0]
        self.assertIn("Dahomey", obj_props.get("herkunft", ""))

    def test_visual_photo_chain_forensics_and_decoy_rejection(self):
        """Verifies RootSIFT + 6-DOF Affine RANSAC matches 1902->1908->2024 plates & rejects cousin decoy."""
        with patch.object(serve_graph_api, "is_neo4j_available", return_value=False), patch.object(
            serve_graph_api, "ECHO_RESEARCHER_KEY", "vis-key-2026"
        ):
            res = self.client.get("/api/visual/demo_case")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data["success"])
            self.assertTrue(data["chain_verified"])

            for p in data["pairs"]:
                if p["involves_control"]:
                    self.assertLess(p["inliers"], 7, f"Decoy object falsely matched: {p}")
                    self.assertEqual(p["verdict"], "ABGELEHNT_KEINE_INDIVIDUELLE_UEBEREINSTIMMUNG")
                else:
                    self.assertGreaterEqual(p["inliers"], 20, f"True historical plate pair missed: {p}")
                    self.assertEqual(p["verdict"], "STARKE_INDIVIDUELLE_OBJEKTIDENTITAET")

            # Unauthenticated commit blocked
            unauth = self.client.post(
                "/api/visual/commit_chain",
                json={"bezeichnung": "Testfigur", "actor": "Umlauff", "evidence_summary": "RANSAC"},
            )
            self.assertEqual(unauth.status_code, 401)

            # Authenticated Human-in-the-Loop commit anchors hypothesis into graph
            auth_ok = self.client.post(
                "/api/visual/commit_chain",
                headers={"X-Researcher-Key": "vis-key-2026"},
                json={
                    "inventarnummer": "FOTO-TEST-01",
                    "bezeichnung": "Geschnitzte Ahnenfigur",
                    "community": "Nso (Kamerun)",
                    "actor": "J.F.G. Umlauff",
                    "institution": "Ethnologisches Museum Berlin",
                    "evidence_summary": "29 RANSAC Inliers (RMSE 0.74 px)",
                    "confidence": 0.96,
                },
            )
            self.assertEqual(auth_ok.status_code, 200)
            self.assertEqual(auth_ok.json()["triples_committed"], 2)


class TestEchoTensorMath(unittest.TestCase):
    def test_binary_shannon_entropy_invariants(self):
        p_half = torch.tensor([[0.5, 0.5, 0.5]])
        h_half = binary_shannon_entropy(p_half)
        self.assertTrue(torch.allclose(h_half, torch.full_like(p_half, math.log(2.0)), atol=1e-6))

        p_vals = torch.tensor([0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99])
        h_p = binary_shannon_entropy(p_vals)
        h_sym = binary_shannon_entropy(1.0 - p_vals)
        self.assertTrue(torch.all(h_p >= 0.0))
        self.assertTrue(torch.allclose(h_p, h_sym, atol=1e-6))

        p_ext = torch.tensor([1e-6, 1.0 - 1e-6])
        self.assertLess(float(binary_shannon_entropy(p_ext).max().item()), 1e-4)

    def test_liquid_entropy_loss_penalizes_overconfidence(self):
        target = torch.tensor([[0.5, 0.5, 0.5]])
        pred_uncertain = torch.tensor([[0.5, 0.5, 0.5]], requires_grad=True)
        loss_uncertain = liquid_entropy_loss(pred_uncertain, target, alpha=0.1)
        self.assertAlmostEqual(float(loss_uncertain.item()), 0.0, places=6)

        target_conf = torch.tensor([[0.99, 0.99, 0.99]])
        pred_conf = torch.tensor([[0.99, 0.99, 0.99]], requires_grad=True)
        loss_conf = liquid_entropy_loss(pred_conf, target_conf, alpha=0.1)
        self.assertGreater(float(loss_conf.item()), 0.05)

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
