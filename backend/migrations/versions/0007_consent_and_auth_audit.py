"""Track explicit biometric consent and authentication audit events."""
from alembic import op
import sqlalchemy as sa

revision = '0007_consent_and_auth_audit'
down_revision = '0006_product_intelligence'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('enrolled_people', sa.Column(
        'consent_status', sa.String(20), nullable=False, server_default='pending'))
    op.add_column('enrolled_people', sa.Column('consented_at', sa.BigInteger()))
    op.add_column('enrolled_people', sa.Column(
        'retention_days', sa.BigInteger(), nullable=False, server_default='0'))
    op.add_column('enrolled_people', sa.Column('last_verified', sa.BigInteger()))
    op.create_table(
        'authentication_events',
        sa.Column('id', sa.String(100), primary_key=True),
        sa.Column('person_id', sa.String(100),
                  sa.ForeignKey('enrolled_people.id', ondelete='SET NULL')),
        sa.Column('method', sa.String(30), nullable=False),
        sa.Column('success', sa.BigInteger(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('created', sa.BigInteger(), nullable=False),
    )
    op.create_index(
        'authentication_event_created',
        'authentication_events',
        [sa.text('created DESC'), 'id'],
    )


def downgrade():
    raise RuntimeError('Destructive downgrade disabled; restore a verified backup instead')
