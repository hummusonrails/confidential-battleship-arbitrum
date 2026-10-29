"""Measure real block intervals on Arbitrum and Ethereum from block timestamps.

For each chain: the latest block, then samples spread over a recent window. Reports the average interval over the
whole window, blocks per second, and for Ethereum the share of 12 s slots that produced no block (gaps of 24 s+).
Arbitrum timestamps have 1 s resolution, so its interval is measured as span / block count, not block to block.
"""
import json
import statistics
import time
import urllib.error
import urllib.request

CHAINS = {
    'Arbitrum One': ('https://arb1.arbitrum.io/rpc', 200_000),
    'Arbitrum Sepolia': ('https://sepolia-rollup.arbitrum.io/rpc', 200_000),
    'Ethereum': ('https://ethereum-rpc.publicnode.com', 2_000),
    'Ethereum Sepolia': ('https://ethereum-sepolia-rpc.publicnode.com', 2_000),
}


def rpc(url, calls):
    body = json.dumps([{'jsonrpc': '2.0', 'id': i, 'method': m, 'params': p} for i, (m, p) in enumerate(calls)]).encode()
    req = urllib.request.Request(url, body, {'content-type': 'application/json', 'user-agent': 'blocktimes/1'})
    for attempt in range(8):
        try:
            out = json.loads(urllib.request.urlopen(req, timeout=60).read())
            break
        except urllib.error.HTTPError as error:
            if error.code != 429:
                raise
            time.sleep(2 ** attempt)  # public RPCs rate-limit batches
    else:
        raise RuntimeError(f'{url} kept rate-limiting')
    return [r['result'] for r in sorted(out, key=lambda r: r['id'])]


def stamps(url, numbers):
    got = []
    for i in range(0, len(numbers), 25):
        chunk = numbers[i:i + 25]
        time.sleep(0.3)
        got += [int(b['timestamp'], 16) for b in rpc(url, [('eth_getBlockByNumber', [hex(n), False]) for n in chunk])]
    return got


for name, (url, window) in CHAINS.items():
    latest = int(rpc(url, [('eth_blockNumber', [])])[0], 16)
    first = latest - window
    t0, t1 = stamps(url, [first, latest])
    line = f'{name}: {window} blocks over {(t1 - t0) / 3600:.2f} h, average {(t1 - t0) / window * 1000:.0f} ms per block'
    if name.startswith('Ethereum'):
        recent = list(range(latest - 300, latest + 1))
        ts = stamps(url, recent)
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        missed = sum(g // 12 - 1 for g in gaps)
        line += (f'; last 300 blocks: median {statistics.median(gaps):.0f} s, max {max(gaps)} s, '
                 f'{missed} empty slots of {sum(g // 12 for g in gaps)}')
    else:
        recent = list(range(latest - 1000, latest + 1))
        ts = stamps(url, recent)
        per_second = {}
        for t in ts:
            per_second[t] = per_second.get(t, 0) + 1
        busiest = max(per_second.values())
        line += (f'; last 1000 blocks: {(ts[-1] - ts[0]) / 1000 * 1000:.0f} ms per block, '
                 f'up to {busiest} blocks in one second')
    print(line, flush=True)
