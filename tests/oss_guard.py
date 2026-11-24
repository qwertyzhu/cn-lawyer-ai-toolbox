#!/usr/bin/env python3
"""
Open-Source Integrity & Anti-Leak Guard for CN Lawyer AI Toolbox (cn-lawyer-ai-toolbox).

Runs in GitHub Actions CI and locally via `npm run test:guard`:
1. Verifies Apache-2.0 legal governance & third-party license files exist.
2. Verifies offline PRC laws corpus integrity (4,000+ articles, 1,260 Civil Code articles).
3. Verifies compiled PWA bundle (`dist/`) & Service Worker precache manifest.
4. Verifies shell deployment script syntax (`ops/deploy.sh`).
5. Blocks accidental commits of private keys, live credentials, local OS paths,
   internal infrastructure hosts, or public non-example IPv4 literals.
"""

import ipaddress
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

SCAN_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".sh",
    ".yml",
    ".yaml",
    ".html",
    ".css",
    ".webmanifest",
    ".txt",
}

SKIP_DIRS = {"node_modules", ".git", "dist", "docs"}


def iter_source_files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if rel.name == "package-lock.json":
            continue
        if rel.as_posix() == "public/data/laws-offline.json":
            continue
        if path.suffix.lower() in SCAN_EXTENSIONS or rel.name in {"Dockerfile", ".env.example", "LICENSE", "NOTICE"}:
            yield path, rel


def test_legal_governance_files_present():
    required = [
        "LICENSE",
        "NOTICE",
        "DISCLAIMER.md",
        "SECURITY.md",
        "CONTRIBUTING.md",
        "README.md",
        ".env.example",
        "public/fonts/OFL-LICENSE.txt",
        ".github/workflows/ci.yml",
    ]
    missing = [rel for rel in required if not (ROOT / rel).exists()]
    assert not missing, f"Missing required OSS governance files: {missing}"
    lic_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert "Apache License" in lic_text and "Version 2.0" in lic_text, "LICENSE must be Apache-2.0"


def test_offline_laws_corpus_integrity():
    laws_path = ROOT / "public" / "data" / "laws-offline.json"
    assert laws_path.exists(), "public/data/laws-offline.json must exist"
    data = json.loads(laws_path.read_text(encoding="utf-8"))
    assert data["civilCount"] == 1260, f"Expected 1260 Civil Code articles, got {data['civilCount']}"
    assert data["docCount"] >= 35, f"Expected >=35 companion laws/interpretations, got {data['docCount']}"
    assert data["totalArticles"] >= 4000, f"Expected >=4000 total articles, got {data['totalArticles']}"


def test_dist_pwa_and_service_worker_bundle():
    dist_dir = ROOT / "dist"
    assert (dist_dir / "index.html").exists(), "dist/index.html must exist after build"
    assert (dist_dir / "manifest.webmanifest").exists(), "dist/manifest.webmanifest must exist"
    sw_file = dist_dir / "sw.js"
    assert sw_file.exists(), "dist/sw.js must exist"
    sw_text = sw_file.read_text(encoding="utf-8")
    assert "__CN_LAWYER_CACHE_VERSION__" not in sw_text, "SW cache version placeholder must be injected"
    assert "/data/laws-offline.json" in sw_text, "SW precache must include /data/laws-offline.json"
    assert "/tool-assets/lawyer-fee-workbench.html" in sw_text, "SW precache must include lawyer-fee-workbench.html"
    assert "/fonts/ofl-noto-sans-sc-medium.woff2" in sw_text, "SW precache must include Chinese PDF font"
    fee_wb = (dist_dir / "tool-assets" / "lawyer-fee-workbench.html").read_text(encoding="utf-8")
    assert "window.FIRM_PRESET" in fee_wb and "const STANDARDS" in fee_wb and 'id="trTopTabs"' in fee_wb, (
        "lawyer-fee-workbench.html must contain FIRM_PRESET, 31-province STANDARDS, and top 3-tab switcher"
    )
    assert "tianran_box_activated_license_v2" not in fee_wb, (
        "OSS lawyer-fee-workbench.html must NOT enforce a hardcoded private localStorage redirect"
    )


def test_deploy_script_syntax():
    deploy_sh = ROOT / "ops" / "deploy.sh"
    assert deploy_sh.exists(), "ops/deploy.sh must exist"
    proc = subprocess.run(["bash", "-n", str(deploy_sh)], capture_output=True, text=True)
    assert proc.returncode == 0, f"bash -n failed: {proc.stderr}"


def test_no_forbidden_secret_files_present():
    forbidden_paths = [
        "ops/.keys",
        "ops/.ssh",
        ".env",
        ".account-registry.json",
        ".ima-credentials.json",
    ]
    found = [p for p in forbidden_paths if (ROOT / p).exists()]
    for html in ROOT.glob("*激活码生成器*.html"):
        found.append(html.name)
    assert not found, f"Forbidden secret/runtime files must not exist in OSS tree: {found}"


def test_zero_secrets_and_privacy_redlines():
    forbidden_patterns = [
        ("private-key-pem", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
        ("jwk-private-scalar", re.compile(r'"d"\s*:\s*"[A-Za-z0-9_-]{35,}"')),
        ("live-master-token", re.compile(r"TR-MASTER-[A-Za-z0-9_-]{30,}")),
        ("live-activation-token", re.compile(r"TR1-[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{50,}")),
        ("live-api-secret", re.compile(r"(secret_[a-z0-9]{12,}|sk-(?:proj-|ant-)?[A-Za-z0-9]{24,})")),
        ("local-user-path", re.compile(r"(?:/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/)")),
        ("internal-oa-host", re.compile(r"\b(?:oa|intranet|internal)\.[a-z0-9-]+\.[a-z]{2,}\b", re.IGNORECASE)),
    ]

    ipv4_re = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
    hits = []

    for fp, rel in iter_source_files():
        if rel.as_posix() == "tests/oss_guard.py":
            continue
        text = fp.read_text(encoding="utf-8", errors="ignore")
        for label, pat in forbidden_patterns:
            m = pat.search(text)
            if m:
                hits.append(f"{rel}: [{label}] {m.group(0)[:48]}")

        # Block hardcoded public server IPv4 literals (allow RFC1918/loopback/RFC5737/RFC6598/0.0.0.0)
        for m in ipv4_re.finditer(text):
            ip_str = m.group(1)
            try:
                ip_obj = ipaddress.IPv4Address(ip_str)
            except ValueError:
                continue
            if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_unspecified or ip_obj.is_reserved:
                continue
            # RFC 5737 documentation ranges: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
            if any(
                ip_obj in ipaddress.IPv4Network(net)
                for net in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24")
            ):
                continue
            # Ignore dotted standard/version numbers like 2025.1.1.0 or 8.8.8.8? Flag any non-doc public IP!
            hits.append(f"{rel}: [public-ipv4] {ip_str}")

    assert not hits, "OSS Anti-Leak Guard failed:\n  " + "\n  ".join(hits)


def main():
    tests = [
        ("legal_governance_files_present", test_legal_governance_files_present),
        ("offline_laws_corpus_integrity", test_offline_laws_corpus_integrity),
        ("dist_pwa_and_service_worker_bundle", test_dist_pwa_and_service_worker_bundle),
        ("deploy_script_syntax", test_deploy_script_syntax),
        ("no_forbidden_secret_files_present", test_no_forbidden_secret_files_present),
        ("zero_secrets_and_privacy_redlines", test_zero_secrets_and_privacy_redlines),
    ]
    passed = 0
    for name, fn in tests:
        fn()
        print(f"  [PASS] {name}")
        passed += 1
    print(f"\nAll {passed}/{len(tests)} OSS integrity & anti-leak guard checks passed!")


if __name__ == "__main__":
    main()
