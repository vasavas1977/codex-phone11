"""Exercise Windows checkout bytes used by the native build receipt."""
import hashlib
import pathlib
import subprocess
import tempfile
import unittest

NATIVE = pathlib.Path(__file__).resolve().parent
INPUTS = ("CMakeLists.txt", "phone11_siprix_helper.cpp", "test_bootstrap.py")


def git(root, *args):
    return subprocess.check_output(
        ["git", "-C", str(root), *args], stderr=subprocess.PIPE
    )


class CanonicalCheckout(unittest.TestCase):
    def checkout(self, with_attributes):
        with tempfile.TemporaryDirectory(prefix="phone11-canonical-checkout-") as tmp:
            source = pathlib.Path(tmp) / "source"
            source.mkdir()
            git(source, "init", "--quiet")
            native = source / "desktop" / "native"
            native.mkdir(parents=True)
            for name in INPUTS:
                # Text-mode reads remove the host checkout's line endings.
                data = (NATIVE / name).read_text(encoding="utf-8").encode("utf-8")
                (native / name).write_bytes(data)
            if with_attributes:
                (native / ".gitattributes").write_bytes(
                    (NATIVE / ".gitattributes").read_bytes()
                )
            (native / "unrelated.txt").write_bytes(b"unrelated\n")
            git(source, "-c", "core.autocrlf=false", "add", ".")
            git(source, "-c", "user.name=Phone11 Checkout Test",
                "-c", "user.email=checkout-test@invalid.example",
                "commit", "--quiet", "-m", "fixture")
            target = pathlib.Path(tmp) / "windows-checkout"
            git(source, "clone", "--quiet", "--no-checkout", str(source), str(target))
            git(target, "config", "core.autocrlf", "true")
            git(target, "checkout", "--quiet", "HEAD", "--", ".")
            for name in INPUTS:
                blob = git(target, "show", f"HEAD:desktop/native/{name}")
                consumed = (target / "desktop" / "native" / name).read_bytes()
                if with_attributes:
                    self.assertEqual(consumed, blob, name)
                    self.assertNotIn(b"\r\n", consumed, name)
                else:
                    self.assertEqual(consumed, blob.replace(b"\n", b"\r\n"), name)
                    self.assertNotEqual(hashlib.sha256(consumed).digest(),
                                        hashlib.sha256(blob).digest(), name)
            self.assertEqual(
                (target / "desktop" / "native" / "unrelated.txt").read_bytes(),
                b"unrelated\r\n",
            )

    def test_windows_native_inputs_match_receipt_git_blobs(self):
        self.checkout(True)

    def test_unpinned_checkout_reproduces_receipt_mismatch(self):
        self.checkout(False)


if __name__ == "__main__":
    unittest.main()
