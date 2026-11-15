"""Preserve consent for profiles enrolled before consent tracking existed."""
from alembic import op
import sqlalchemy as sa

revision = '0008_backfill_existing_consent'
down_revision = '0007_consent_and_auth_audit'
branch_labels = None
depends_on = None


def upgrade():
    people = sa.table(
        'enrolled_people',
        sa.column('consent_status', sa.String()),
        sa.column('consented_at', sa.BigInteger()),
        sa.column('created', sa.BigInteger()),
        sa.column('enrollment_state', sa.String()),
    )
    op.execute(
        people.update()
        .where(
            sa.and_(
                people.c.consent_status == 'pending',
                people.c.enrollment_state != 'revoked',
            )
        )
        .values(
            consent_status='granted',
            consented_at=people.c.created,
        )
    )


def downgrade():
    raise RuntimeError('Destructive downgrade disabled; restore a verified backup instead')
