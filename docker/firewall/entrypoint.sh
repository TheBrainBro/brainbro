#!/bin/sh
# Lets the stack's subnet through the host's nftables FORWARD chain.
#
# On Umbrel, Portainer's Docker shares the host's network namespace with
# umbrelOS's Docker. umbrelOS's Docker sets the nftables FORWARD policy to drop,
# while Portainer's Docker writes its own accept rules with iptables-legacy,
# which that policy never sees. Without these rules no traffic leaves our
# containers: not to each other, not to the internet.
#
# DOCKER-USER is the chain Docker keeps for user rules. The check runs every
# minute so the rules come back if umbrelOS's Docker restarts.
set -u

SUBNET="${STACK_SUBNET:?STACK_SUBNET is required}"

allow_subnet() {
  for direction in -s -d; do
    iptables-nft -C DOCKER-USER "$direction" "$SUBNET" -j ACCEPT 2>/dev/null ||
      iptables-nft -I DOCKER-USER "$direction" "$SUBNET" -j ACCEPT ||
      return 1
  done
}

if allow_subnet; then
  echo "Forwarding allowed for $SUBNET."
else
  echo "Could not add the DOCKER-USER rules for $SUBNET; is this an Umbrel host?" >&2
fi
# Ready either way: on hosts without that chain the stack works without it.
touch /tmp/ready

while true; do
  sleep 60
  allow_subnet >/dev/null 2>&1 || true
done
