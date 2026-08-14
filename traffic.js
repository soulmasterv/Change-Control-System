const requests = [
  { summary: "Upgrade Pi-hole to latest version", device: "Ubuntu server", priority: "Medium", impact: "Low", desc: "Scheduled upgrade of Pi-hole DNS blocker.", rollback: "Restore previous Docker image." },
  { summary: "Extend root partition to 120GB", device: "Ubuntu server (sda)", priority: "High", impact: "High", desc: "Root partition approaching capacity limit.", rollback: "Restore from disk snapshot." },
  { summary: "Restart Immich container after update", device: "Ubuntu server", priority: "Low", impact: "Low", desc: "Immich update requires container restart.", rollback: "Rollback to previous image version." },
  { summary: "Update Tailscale on Haier TV", device: "Haier MatrixTV EE", priority: "Medium", impact: "Low", desc: "Tailscale client outdated, VPN dropping.", rollback: "Uninstall and reinstall previous version." },
  { summary: "Rotate ADB wireless debugging port", device: "Haier MatrixTV EE", priority: "Low", impact: "Low", desc: "Wireless debugging port changed after reboot.", rollback: "Re-pair using Wireless Debugging menu." },
  { summary: "Migrate Docker volumes to SSD", device: "Ubuntu server", priority: "High", impact: "Medium", desc: "Move Docker data directory to faster SSD.", rollback: "Repoint symlink back to original path." },
  { summary: "Update Nginx Proxy Manager", device: "Ubuntu server", priority: "Medium", impact: "Medium", desc: "NPM update available with security fixes.", rollback: "Restore previous container image." },
  { summary: "Clean up Docker unused images", device: "Ubuntu server", priority: "Low", impact: "Low", desc: "docker system prune to free disk space.", rollback: "No rollback needed." },
  { summary: "Update Gitea to latest version", device: "Ubuntu server", priority: "Medium", impact: "Low", desc: "Gitea update with bug fixes.", rollback: "Restore previous Gitea data volume." },
  { summary: "Change Pi-hole DNS upstream server", device: "Ubuntu server", priority: "Low", impact: "Medium", desc: "Switch upstream DNS from Google to Cloudflare.", rollback: "Revert DNS settings in Pi-hole admin." },
  { summary: "Reboot Ubuntu server for kernel update", device: "Ubuntu server", priority: "High", impact: "High", desc: "Kernel update requires full reboot.", rollback: "Boot previous kernel from GRUB menu." },
  { summary: "Update Uptime Kuma monitors", device: "Ubuntu server", priority: "Low", impact: "Low", desc: "Add new monitors for change control system.", rollback: "Delete newly added monitors." },
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomId(existing) {
  const nums = existing.map(r => parseInt(r.id.replace('CR-', ''))).filter(n => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'CR-' + String(next).padStart(3, '0');
}

async function run() {
  const res = await fetch('http://localhost:3000/api/data');
  const state = await res.json();

  const template = randomItem(requests);
  const newCR = {
    id: randomId(state.changeRequests),
    summary: template.summary,
    date: new Date(Date.now() + 86400000 * Math.floor(Math.random() * 7 + 1)).toISOString().slice(0, 16),
    priority: template.priority,
    impact: template.impact,
    device: template.device,
    desc: template.desc,
    rollback: template.rollback,
    status: 'pending-review',
    author: 'system',
    comments: [{ author: 'system', time: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), text: 'Auto-generated change request.' }],
    created: new Date().toISOString().split('T')[0]
  };

  state.changeRequests.push(newCR);

  await fetch('http://localhost:3000/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });

  console.log(`[${new Date().toLocaleTimeString()}] Created ${newCR.id}: ${newCR.summary}`);
}

run().catch(console.error);
