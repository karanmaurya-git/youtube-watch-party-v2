import { ROLE_LABEL } from '../utils/format.js';

const ICON = { host: '👑', moderator: '🛡️', participant: '👤' };

export default function RoleBadge({ role }) {
  return (
    <span className={`badge badge-${role}`}>
      <span aria-hidden="true">{ICON[role]}</span> {ROLE_LABEL[role]}
    </span>
  );
}
