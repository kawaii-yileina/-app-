import type { GroupMemberAvatar } from '../../types';
import { useCachedMediaUrl } from '../../hooks/useCachedMediaUrl';
import { avatarTint } from '../../utils/avatarColor';
import SharedAvatar from '../SharedAvatar';
import styles from './index.module.css';

interface Props {
  name?: string;
  avatar?: string;
  members?: GroupMemberAvatar[];
  size?: number;
  className?: string;
}

interface CellLayout {
  col: number;
  row: number;
}

function layoutFor(count: number): { cols: number; rows: number; cells: CellLayout[] } {
  switch (count) {
    case 1:
      return { cols: 1, rows: 1, cells: [{ col: 1, row: 1 }] };
    case 2:
      return { cols: 2, rows: 1, cells: [{ col: 1, row: 1 }, { col: 1, row: 1 }] };
    case 3:
      return { cols: 2, rows: 2, cells: [{ col: 1, row: 2 }, { col: 1, row: 1 }, { col: 1, row: 1 }] };
    case 4:
      return { cols: 2, rows: 2, cells: Array.from({ length: 4 }, () => ({ col: 1, row: 1 })) };
    case 5:
      return { cols: 6, rows: 2, cells: [{ col: 2, row: 1 }, { col: 2, row: 1 }, { col: 2, row: 1 }, { col: 3, row: 1 }, { col: 3, row: 1 }] };
    case 6:
      return { cols: 3, rows: 2, cells: Array.from({ length: 6 }, () => ({ col: 1, row: 1 })) };
    case 7:
      return { cols: 6, rows: 3, cells: [{ col: 3, row: 1 }, { col: 3, row: 1 }, { col: 2, row: 1 }, { col: 2, row: 1 }, { col: 2, row: 1 }, { col: 3, row: 1 }, { col: 3, row: 1 }] };
    case 8:
      return { cols: 4, rows: 2, cells: Array.from({ length: 8 }, () => ({ col: 1, row: 1 })) };
    case 9:
      return { cols: 3, rows: 3, cells: Array.from({ length: 9 }, () => ({ col: 1, row: 1 })) };
    default:
      return { cols: 1, rows: 1, cells: [{ col: 1, row: 1 }] };
  }
}

const MemberCell = ({ member }: { member: GroupMemberAvatar }) => {
  const { url, failed, onError } = useCachedMediaUrl(member.avatar, true);
  if (url && !failed) {
    return <img className={styles.cell} src={url} alt={member.nickname} onError={onError} />;
  }
  return (
    <div className={styles.cell} style={{ background: avatarTint(member.nickname || '') }}>
      {member.nickname?.charAt(0) || '?'}
    </div>
  );
};

const GroupAvatar = ({ name, avatar, members, size = 40, className }: Props) => {
  if (avatar) {
    return <SharedAvatar name={name} src={avatar} size={size} className={className} />;
  }
  const visible = (members || []).slice(0, 9);
  if (visible.length === 0) {
    return <SharedAvatar name={name} size={size} className={className} />;
  }
  const layout = layoutFor(visible.length);
  return (
    <div
      className={`${styles.grid} ${className || ''}`}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      }}
    >
      {visible.map((member, index) => {
        const cell = layout.cells[index];
        return (
          <div
            key={`${member.nickname}-${index}`}
            className={styles.cellWrap}
            style={{ gridColumn: `span ${cell.col}`, gridRow: `span ${cell.row}` }}
          >
            <MemberCell member={member} />
          </div>
        );
      })}
    </div>
  );
};

export default GroupAvatar;
