"""Add voice samples table for speaker biometric authentication."""
from alembic import op
import sqlalchemy as sa

revision = '0005_voice_samples'
down_revision = '0004_identity_samples'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('voice_samples',
        sa.Column('id', sa.String(100), primary_key=True),
        sa.Column('person_id', sa.String(100), sa.ForeignKey('enrolled_people.id', ondelete='CASCADE'), nullable=False),
        sa.Column('embedding', sa.LargeBinary(), nullable=False),
        sa.Column('sample_hash', sa.String(64), nullable=False),
        sa.Column('passphrase', sa.String(200), nullable=False, server_default='Authorize Oracle System'),
        sa.Column('duration_ms', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('created', sa.BigInteger(), nullable=False),
        sa.Column('quality', sa.Text(), nullable=False)
    )
    op.create_index('voice_sample_person', 'voice_samples', ['person_id'])
    op.create_index('voice_sample_unique', 'voice_samples', ['person_id', 'sample_hash'], unique=True)

def downgrade():
    raise RuntimeError('Destructive downgrade disabled; restore a verified backup instead')
