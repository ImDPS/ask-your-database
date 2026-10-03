# Safety checks for load_chinook.py. Standard library only, so it can be tested without a database.
# The loader drops the 11 public Chinook tables with CASCADE, so it must be hard to point at the
# wrong database by accident. Nothing here ever returns or prints the user name or the password.
from urllib.parse import urlsplit, parse_qs

LOCAL_HOSTS = {"localhost", "127.0.0.1"}
MIN_PASSWORD_LENGTH = 12
PLACEHOLDER_PASSWORD = "change-me"


def target_of(url):
    """Return (hosts, database) for a postgres URL. hosts is a list of host names, never credentials."""
    parts = urlsplit(url)
    # Only the part after the last '@' is host and port, so a password containing ':' or '@' is ignored.
    hostport = parts.netloc.rpartition("@")[2]
    hosts = []
    for item in hostport.split(","):
        item = item.strip()
        if item.startswith("["):
            # An IPv6 literal such as [::1]:5432.
            hosts.append(item[1:].split("]")[0])
        else:
            hosts.append(item.rsplit(":", 1)[0] if ":" in item else item)
    # libpq lets host= or hostaddr= in the query string override the host in the URL.
    query = parse_qs(parts.query)
    for key in ("host", "hostaddr"):
        for value in query.get(key, []):
            hosts.extend(v.strip() for v in value.split(","))
    database = parts.path.lstrip("/")
    return hosts, database


def is_local(hosts):
    # No host at all means a unix socket or a default, which is not provably local: treat as remote.
    return bool(hosts) and all(h in LOCAL_HOSTS for h in hosts)


def check(url, password, argv):
    """Return None when the load may go ahead, else a message to print before exiting non-zero."""
    if password == PLACEHOLDER_PASSWORD:
        return ("Refusing to run: READONLY_PASSWORD is the placeholder 'change-me'. "
                "Set a real password of at least %d characters." % MIN_PASSWORD_LENGTH)
    if len(password) < MIN_PASSWORD_LENGTH:
        return ("Refusing to run: READONLY_PASSWORD is shorter than %d characters (it has %d). "
                "Set a longer one." % (MIN_PASSWORD_LENGTH, len(password)))
    hosts, database = target_of(url)
    if not is_local(hosts):
        shown = ", ".join(h or "(none)" for h in hosts) or "(none)"
        if "--confirm" not in argv:
            return ("This is not a local database (host: %s, database: %s).\n"
                    "The loader drops the 11 public Chinook tables with CASCADE and recreates them.\n"
                    "Nothing was changed. Run it again with --confirm if that is what you want."
                    % (shown, database or "(none)"))
        print("Target host: %s, database: %s (--confirm given)" % (shown, database or "(none)"))
    return None
