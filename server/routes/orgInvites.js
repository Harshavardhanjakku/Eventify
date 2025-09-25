const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const { validate: isUuid } = require('uuid');

// Helper function to get Keycloak admin token
const getKeycloakAdminToken = async () => {
  try {
    const response = await axios.post(
      `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/realms/master/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'password',
        username: process.env.KEYCLOAK_ADMIN_USER || 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin',
        client_id: 'admin-cli',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return response.data.access_token;
  } catch (err) {
    console.error('❌ Failed to obtain Keycloak admin token:', err.message);
    throw new Error(`Failed to obtain Keycloak admin token: ${err.message}`);
  }
};

// Helper: find Keycloak client by clientId (returns object with id (UUID))
const getKeycloakClientByClientId = async (accessToken, clientId) => {
  try {
    const response = await axios.get(
      `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'docsy'}/clients`,
      {
        params: { clientId },
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const clients = Array.isArray(response.data) ? response.data : [];
    if (!clients.length) {
      throw new Error(`Client not found for clientId=${clientId}`);
    }
    return clients[0];
  } catch (err) {
    console.error('❌ Failed to fetch Keycloak client by clientId:', {
      clientId,
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
    });
    throw err;
  }
};

// Helper: fetch a specific role from a client by name
const getClientRoleByName = async (accessToken, clientUuid, roleName) => {
  try {
    const response = await axios.get(
      `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'docsy'}/clients/${clientUuid}/roles/${encodeURIComponent(roleName)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data;
  } catch (err) {
    console.error(`❌ Failed to get role '${roleName}' for client ${clientUuid}:`, err?.response?.data || err.message);
    throw err;
  }
};

// Helper: assign a client role to a user
const assignClientRoleToUser = async (accessToken, keycloakUserId, clientUuid, roleRepresentation) => {
  try {
    const payload = [
      {
        id: roleRepresentation.id,
        name: roleRepresentation.name,
        containerId: clientUuid,
        clientRole: true,
      },
    ];
    const response = await axios.post(
      `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'docsy'}/users/${keycloakUserId}/role-mappings/clients/${clientUuid}`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    if (response.status === 204) {
      console.log(`✅ Assigned role '${roleRepresentation.name}' to user ${keycloakUserId} for client ${clientUuid}`);
    } else {
      console.warn(`⚠️ Unexpected status when assigning role '${roleRepresentation.name}': ${response.status}`);
    }
  } catch (err) {
    console.error(`❌ Failed to assign role '${roleRepresentation?.name}' to user ${keycloakUserId}:`, err?.response?.data || err.message);
    throw err;
  }
};

// DB Helper: ensure eventify_organization_invites.role column exists
const ensureOrganizationInvitesRoleColumn = async (client) => {
  const checkQuery = `
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'eventify_organization_invites' AND column_name = 'role'
  `;
  const result = await client.query(checkQuery);
  if (result.rows.length === 0) {
    console.log("ℹ️ Adding missing column eventify_organization_invites.role (text)");
    await client.query("ALTER TABLE eventify_organization_invites ADD COLUMN role TEXT");
  }
};

// Test route
router.get('/test', (req, res) => {
  res.json({ message: 'Org invites route is working!' });
});

// POST /send - Send organization invite
router.post('/send', async (req, res) => {
  const { email, invited_by, message, role } = req.body;
  if (!email || !invited_by) {
    return res.status(400).json({ error: 'email and invited_by are required' });
  }
  const allowedRoles = ['Organizer', 'User'];
  const inviteRole = role || 'User';
  if (!allowedRoles.includes(inviteRole)) {
    return res.status(400).json({ error: `Invalid role. Allowed: ${allowedRoles.join(', ')}` });
  }
  // DB expects lowercase values ('organizer','user') due to CHECK constraint
  const inviteRoleDb = String(inviteRole).toLowerCase() === 'organizer' ? 'organizer' : 'user';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve inviter: try keycloak_id, then internal id, then email
    let inviterInternalId = null;
    let inviterLookup;
    // Try keycloak_id
    inviterLookup = await client.query('SELECT id FROM eventify_users WHERE keycloak_id = $1', [invited_by]);
    if (inviterLookup.rows.length === 0) {
      // If invited_by is a UUID, try internal id
      if (isUuid(invited_by)) {
        inviterLookup = await client.query('SELECT id FROM eventify_users WHERE id = $1', [invited_by]);
      }
    }
    if (inviterLookup.rows.length === 0) {
      // If invited_by looks like email, try email
      if (String(invited_by).includes('@')) {
        inviterLookup = await client.query('SELECT id FROM eventify_users WHERE email = $1', [invited_by]);
      }
    }
    if (inviterLookup.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Inviter user not found in system' });
    }
    inviterInternalId = inviterLookup.rows[0].id;

    // Lookup inviter's organization with preference for orgAdmin; fallback to any membership
    let organization = null;
    let orgResult = await client.query(
      `SELECT o.id, o.name, o.keycloak_org_id
       FROM eventify_organizations o
       JOIN eventify_organization_users ou ON o.id = ou.organization_id
       WHERE ou.user_id = $1 AND ou.role = 'orgAdmin'
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [inviterInternalId]
    );
    if (orgResult.rows.length > 0) {
      organization = orgResult.rows[0];
    } else {
      // Fallback: any organization membership
      orgResult = await client.query(
        `SELECT o.id, o.name, o.keycloak_org_id
         FROM eventify_organizations o
         JOIN eventify_organization_users ou ON o.id = ou.organization_id
         WHERE ou.user_id = $1
         ORDER BY (ou.role = 'organizer') DESC, o.created_at DESC
         LIMIT 1`,
        [inviterInternalId]
      );
      if (orgResult.rows.length > 0) {
        organization = orgResult.rows[0];
      }
    }
    if (!organization) {
      await client.query('ROLLBACK');
      client.release();
      console.warn('Invite failed: no organization membership found for inviter', { inviterInternalId });
      return res.status(404).json({ error: 'No organization found for inviter' });
    }

    // Check if user with this email already exists
    const existingUserResult = await client.query(
      'SELECT id FROM eventify_users WHERE email = $1',
      [email]
    );
    const existingUserId = existingUserResult.rows.length > 0 ? existingUserResult.rows[0].id : null;

    // Check if already member
    if (existingUserId) {
      const memberCheck = await client.query(
      'SELECT id FROM eventify_organization_users WHERE organization_id = $1 AND user_id = $2',
        [organization.id, existingUserId]
      );
      if (memberCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'User is already a member of your organization' });
      }
    }

    // Check if already pending
    const inviteCheck = await client.query(
      "SELECT id FROM eventify_organization_invites WHERE organization_id = $1 AND email = $2 AND status = 'pending'",
      [organization.id, email]
    );

    if (inviteCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ error: 'Invitation already sent to this email' });
    }

    // Generate token for invite
    const token = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    // Create invite
    const result = await client.query(
      'INSERT INTO eventify_organization_invites (organization_id, email, role, invited_by, token, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [organization.id, email, inviteRoleDb, inviterInternalId, token, expiresAt]
    );

    await client.query('COMMIT');
    client.release();

    // Notify via socket.io if user exists
    const io = req.app.get('io');
    if (io && existingUserId) {
      const existingUserKeycloakResult = await pool.query(
        'SELECT keycloak_id FROM eventify_users WHERE id = $1',
        [existingUserId]
      );
      if (existingUserKeycloakResult.rows.length > 0) {
        io.to(`user_${existingUserKeycloakResult.rows[0].keycloak_id}`).emit('org-invite', {
          from: invited_by,
          organizationName: organization.name,
          message: message,
          inviteId: result.rows[0].id
        });
      }
    }

    res.status(201).json({
      message: 'Organization invitation sent successfully',
      invite: result.rows[0],
      organizationName: organization.name
    });

  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Error sending org invitation:', err);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// GET /pending/:userId - Get pending invites for user (internal UUID)
router.get('/pending/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!isUuid(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  try {
    const result = await pool.query(`
      SELECT oi.*, o.name as organization_name, u.username as invited_by_username
      FROM eventify_organization_invites oi
      INNER JOIN eventify_organizations o ON oi.organization_id = o.id
      INNER JOIN eventify_users u ON oi.invited_by = u.id
      WHERE oi.email = (SELECT email FROM eventify_users WHERE id = $1) AND oi.status = 'pending'
      ORDER BY oi.created_at DESC
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending invites:', err);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// POST /accept/:inviteId - Accept organization invite with Keycloak integration
router.post('/accept/:inviteId', async (req, res) => {
  const { inviteId } = req.params;
  if (!isUuid(inviteId)) {
    return res.status(400).json({ error: 'Invalid invite ID' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get invitation details with organization and Keycloak org ID
    const inviteResult = await client.query(`
      SELECT oi.*, o.name as organization_name, o.keycloak_org_id, u_inviter.username as inviter_username
      FROM eventify_organization_invites oi
      INNER JOIN eventify_organizations o ON oi.organization_id = o.id
      INNER JOIN eventify_users u_inviter ON oi.invited_by = u_inviter.id
      WHERE oi.id = $1 AND oi.status = 'pending'
    `, [inviteId]);

    if (inviteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }
    const invite = inviteResult.rows[0];

    // Get invited user's keycloak_id by email
    const userResult = await client.query(
      'SELECT id, keycloak_id, username FROM eventify_users WHERE email = $1',
      [invite.email]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'User not found' });
    }
    const invitedUser = userResult.rows[0];

    // Add user to organization in local database with invited role (idempotent)
    await client.query(
      `INSERT INTO eventify_organization_users (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, updated_at = CURRENT_TIMESTAMP`,
      [invite.organization_id, invitedUser.id, invite.role]
    );

    // No special tables for Organizer/User at accept-time in current design

    // Update invite status
    await client.query(
      'UPDATE eventify_organization_invites SET status = \'accepted\', updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [inviteId]
    );

    await client.query('COMMIT');
    client.release();

    // Add user to Keycloak organization using invite-existing-user API (email invite)
    if (invite.keycloak_org_id && invitedUser.keycloak_id) {
      try {
        const accessToken = await getKeycloakAdminToken();

        // Use form data for the invite-existing-user endpoint
        const formData = new URLSearchParams();
        formData.append('id', invitedUser.keycloak_id);

        await axios.post(
          `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'docsy'}/organizations/${invite.keycloak_org_id}/members/invite-existing-user`,
          formData,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );

        console.log('✅ User invited via Keycloak invite-existing-user:', {
          keycloakId: invitedUser.keycloak_id,
          username: invitedUser.username,
          orgId: invite.keycloak_org_id
        });
      } catch (kcErr) {
        const errorMessage = kcErr?.response?.data?.errorMessage || kcErr.message;
        const statusCode = kcErr?.response?.status;
        console.warn('⚠️ invite-existing-user failed:', {
          status: statusCode,
          errorMessage: errorMessage,
          response: kcErr.response?.data,
        });
        // If invite fails due to email sending issues, fall back to direct membership (no email)
        if (statusCode === 500 && errorMessage && errorMessage.toLowerCase().includes('invite email')) {
          try {
            const accessToken = await getKeycloakAdminToken();
            await axios.post(
              `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'docsy'}/organizations/${invite.keycloak_org_id}/members`,
              invitedUser.keycloak_id,
              {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                }
              }
            );
            console.log('✅ Fallback: User added to Keycloak organization (direct membership, no email):', {
              keycloakId: invitedUser.keycloak_id,
              username: invitedUser.username,
              orgId: invite.keycloak_org_id
            });
          } catch (fallbackErr) {
            console.warn('⚠️ Fallback direct membership also failed:', {
              error: fallbackErr.message,
              response: fallbackErr.response?.data,
              status: fallbackErr.response?.status,
            });
          }
        }
        // Don't fail the entire operation if Keycloak fails
      }
    }

    // Map client role to invited user (best-effort; non-blocking)
    try {
      const accessToken = await getKeycloakAdminToken();
      const inviterUsername = invite.inviter_username; // selected in the query above
      const inviterClientId = inviterUsername ? `client-${inviterUsername}` : null;
      if (inviterClientId) {
        const clientObj = await getKeycloakClientByClientId(accessToken, inviterClientId);
        if (clientObj && clientObj.id) {
          // Translate DB role to Keycloak client role names (invite.role may be lowercase)
          const roleNameKc = (String(invite.role).toLowerCase() === 'organizer') ? 'organizer' : 'user';
          const roleRep = await getClientRoleByName(accessToken, clientObj.id, roleNameKc);
          await assignClientRoleToUser(accessToken, invitedUser.keycloak_id, clientObj.id, roleRep);
          console.log('✅ Assigned client role to invited user:', { user: invitedUser.username, role: roleNameKc, clientId: inviterClientId });
        } else {
          console.warn('⚠️ Inviter client not found for role mapping:', { inviterClientId });
        }
      }
    } catch (mapErr) {
      console.warn('⚠️ Failed to map client role to invited user:', mapErr?.message || mapErr);
      // proceed without failing the request
    }

    console.log('✅ Invitation accepted:', inviteId);

    res.json({
      message: 'Invitation accepted successfully',
      organizationName: invite.organization_name
    });

  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Error accepting invitation:', err);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// POST /reject/:inviteId - Reject organization invite
router.post('/reject/:inviteId', async (req, res) => {
  const { inviteId } = req.params;
  if (!isUuid(inviteId)) {
    return res.status(400).json({ error: 'Invalid invite ID' });
  }

  try {
    const result = await pool.query(`
      UPDATE eventify_organization_invites SET status = 'rejected', updated_at = CURRENT_TIMESTAMP 
      WHERE id = $1 AND status = 'pending' RETURNING *
    `, [inviteId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }

    console.log('✅ Invitation rejected:', inviteId);
    res.json({ message: 'Invitation rejected successfully' });

  } catch (err) {
    console.error('❌ Error rejecting invitation:', err);
    res.status(500).json({ error: 'Failed to reject invitation' });
  }
});

module.exports = router;
