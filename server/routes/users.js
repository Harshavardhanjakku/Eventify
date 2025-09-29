const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const axios = require("axios");
const { validate: isUuid } = require("uuid");
const { publish } = require('../config/rabbitmq');

// Helper function to retry a promise-based action
const retry = async (fn, retries = 3, delay = 500) => {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) {
      console.log(
        `Attempt failed, retrying in ${delay}ms... (${retries} retries left)`
      );
      await new Promise((res) => setTimeout(res, delay));
      return retry(fn, retries - 1, delay);
    } else {
      throw err;
    }
  }
};

// Function to create a role in the given client
const createClientRole = async (accessToken, clientUuid, roleName) => {
  try {
    const response = await axios.post(
      `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/admin/realms/${process.env.KEYCLOAK_REALM || "docsy"}/clients/${clientUuid}/roles`,
      {
        name: roleName,
        description: `${roleName} role`,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status === 201 || response.status === 204) {
      console.log(
        `✅ Client role '${roleName}' created for client ${clientUuid}`
      );
    } else {
      console.warn(
        `⚠️ Unexpected status when creating role '${roleName}': ${response.status}`
      );
    }
  } catch (err) {
    if (err?.response?.status === 409) {
      // 409 means already exists
      console.log(
        `ℹ️ Role '${roleName}' already exists for client ${clientUuid}`
      );
    } else {
      console.error(
        `❌ Failed to create client role '${roleName}':`,
        err?.response?.data || err.message
      );
    }
  }
};

// Fetch a specific role from a Keycloak client by role name
const getClientRoleByName = async (accessToken, clientUuid, roleName) => {
  try {
    const response = await axios.get(
      `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/admin/realms/${process.env.KEYCLOAK_REALM || "docsy"}/clients/${clientUuid}/roles/${encodeURIComponent(roleName)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    return response.data;
  } catch (err) {
    console.error(
      `❌ Failed to fetch role '${roleName}' for client ${clientUuid}:`,
      err?.response?.data || err.message
    );
    throw err;
  }
};

// Assign a client role to a user in Keycloak
const assignClientRoleToUser = async (
  accessToken,
  keycloakUserId,
  clientUuid,
  roleRepresentation
) => {
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
      `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/admin/realms/${process.env.KEYCLOAK_REALM || "docsy"}/users/${keycloakUserId}/role-mappings/clients/${clientUuid}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status === 204) {
      console.log(
        `✅ Assigned role '${roleRepresentation.name}' to user ${keycloakUserId} for client ${clientUuid}`
      );
    } else {
      console.warn(
        `⚠️ Unexpected status when assigning role '${roleRepresentation.name}': ${response.status}`
      );
    }
  } catch (err) {
    console.error(
      `❌ Failed to assign role '${roleRepresentation?.name}' to user ${keycloakUserId}:`,
      err?.response?.data || err.message
    );
    throw err;
  }
};

// Function to sanitize organization name (remove spaces and special characters)
const sanitizeOrgName = (name) => name.replace(/\s+/g, "-").toLowerCase();

// Function to generate a unique domain (e.g., based on orgName)
const generateDomain = (orgName) => `${orgName}.org`; // Example: org-of-demo19.org

// Function to create a client in Keycloak
const createKeycloakClient = async (accessToken, username) => {
  try {
    const clientId = `client-${username}`;
    const clientSecret = `${username}-secret-${Date.now()}`;

    const clientPayload = {
      clientId: clientId,
      enabled: true,
      protocol: "openid-connect",
      secret: clientSecret,
      serviceAccountsEnabled: false,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: true,
      publicClient: false,
      redirectUris: ["*"],
      webOrigins: ["*"],
    };

    const response = await axios.post(
      `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/admin/realms/${process.env.KEYCLOAK_REALM || "docsy"}/clients`,
      clientPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status === 201) {
      let clientUuid = null;
      if (response.headers.location) {
        const locationParts = response.headers.location.split("/");
        clientUuid = locationParts[locationParts.length - 1];
      }

      console.log("✅ Keycloak client created successfully:", {
        clientId: clientId,
        clientUuid: clientUuid,
        username: username,
      });

      return {
        clientId: clientId,
        clientUuid: clientUuid,
        clientSecret: clientSecret,
      };
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (err) {
    console.error("❌ Failed to create Keycloak client:", {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      username: username,
    });
    throw err;
  }
};

const getKeycloakAdminToken = async () => {
  try {
    const response = await axios.post(
      `http://localhost:8080/realms/master/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: "password",
        username: process.env.KEYCLOAK_ADMIN_USER || "admin",
        password: process.env.KEYCLOAK_ADMIN_PASSWORD || "admin",
        client_id: "admin-cli",
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    console.log("✅ Keycloak admin token obtained successfully");
    return response.data.access_token;
  } catch (err) {
    console.error("❌ Failed to obtain Keycloak admin token:", {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      clientId: process.env.KEYCLOAK_ADMIN_USER || "admin",
      keycloakUrl: process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080",
    });
    throw new Error(`Failed to obtain Keycloak admin token: ${err.message}`);
  }
};

// Find an existing Keycloak Group by name (used as Organization container)
const findGroupByName = async (accessToken, groupName) => {
  try {
    const response = await axios.get(
      `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/admin/realms/${process.env.KEYCLOAK_REALM || "docsy"}/groups`,
      {
        params: { search: groupName },
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const matched = (response.data || []).find(g => String(g.name).toLowerCase() === String(groupName).toLowerCase());
    return matched || null;
  } catch (err) {
    console.warn("Failed to search Keycloak groups:", err?.response?.data || err.message);
    return null;
  }
};

// Create a Keycloak Group used to represent an Organization
const createGroup = async (accessToken, groupName) => {
  const url = `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/admin/realms/${process.env.KEYCLOAK_REALM || "docsy"}/groups`;
  const payload = { name: groupName };
  const resp = await axios.post(url, payload, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } });
  // Keycloak returns 201 with Location header pointing to the created group
  if ((resp.status === 201 || resp.status === 204) && resp.headers.location) {
    const parts = resp.headers.location.split('/');
    const groupId = parts[parts.length - 1];
    return { id: groupId, name: groupName };
  }
  // Fallback: refetch
  const found = await findGroupByName(accessToken, groupName);
  if (!found) throw new Error("Failed to create or locate Keycloak group");
  return { id: found.id, name: found.name };
};

// Ensure a Keycloak Group exists and return its id
const ensureGroup = async (accessToken, groupName) => {
  const existing = await findGroupByName(accessToken, groupName);
  if (existing?.id) return existing;
  return await createGroup(accessToken, groupName);
};

// Add a Keycloak user to a Group (organization membership)
const addUserToGroup = async (accessToken, keycloakUserId, groupId) => {
  try {
    const url = `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/admin/realms/${process.env.KEYCLOAK_REALM || "docsy"}/users/${keycloakUserId}/groups/${groupId}`;
    const resp = await axios.put(url, {}, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (resp.status === 204) {
      console.log("✅ Added user to Keycloak group", { keycloakUserId, groupId });
    } else {
      console.warn("⚠️ Unexpected status adding user to group:", resp.status);
    }
  } catch (err) {
    // If already in group, Keycloak may still return 204. Log other errors
    console.warn("Failed to add user to Keycloak group:", err?.response?.data || err.message);
  }
};

// ---------- Keycloak Organizations API helpers ----------
const createOrganization = async (accessToken, orgName, domain) => {
  const base = process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080";
  const realm = process.env.KEYCLOAK_REALM || "docsy";
  const url = `${base}/admin/realms/${realm}/organizations`;
  const payload = { name: orgName, domains: Array.isArray(domain) ? domain : [domain] };
  console.log("Creating Keycloak Organization", { url, payload });
  const resp = await axios.post(url, payload, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } });
  console.log("Organization create response", { status: resp.status, headers: resp.headers, data: resp.data });
  if (resp.status === 201) {
    if (resp.data?.id) return resp.data.id;
    if (resp.headers?.location) {
      const parts = resp.headers.location.split('/');
      return parts[parts.length - 1];
    }
  }
  throw new Error(`Unexpected status from org create: ${resp.status}`);
};

const addMemberToOrganization = async (accessToken, orgId, keycloakUserId) => {
  const base = process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080";
  const realm = process.env.KEYCLOAK_REALM || "docsy";
  const url = `${base}/admin/realms/${realm}/organizations/${orgId}/members`;
  const body = String(keycloakUserId);
  console.log("Adding member to Organization", { url, body });
  const resp = await axios.post(url, body, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } });
  console.log("Add member response", { status: resp.status, data: resp.data, headers: resp.headers });
  if (resp.status !== 201 && resp.status !== 204) {
    throw new Error(`Unexpected status from add member: ${resp.status}`);
  }
};

// Function to check if user exists in Keycloak by their ID
const checkUserExists = async (accessToken, keycloakId) => {
  try {
    await axios.get(
      `${process.env.KEYCLOAK_SERVER_URL || "http://localhost:8080"}/admin/realms/${process.env.KEYCLOAK_REALM || "docsy"}/users/${keycloakId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    // If the request succeeds (status 200), the user exists.
    return true;
  } catch (err) {
    // A 404 status specifically means the user does not exist.
    if (err.response && err.response.status === 404) {
      return false;
    }
    // For other errors, log a warning but assume they don't exist to be safe.
    console.warn("Error checking user existence in Keycloak:", {
      message: err.message,
      status: err.response?.status,
    });
    return false;
  }
};

// GET /eventify_users?keycloak_id=<id> or /eventify_users?search=<query>
router.get("/", async (req, res) => {
  const { keycloak_id, search } = req.query;
  try {
    if (keycloak_id && !isUuid(keycloak_id)) {
      console.warn("Invalid keycloak_id:", keycloak_id);
      return res
        .status(400)
        .json({ error: "Invalid keycloak_id: Must be a valid UUID" });
    }

    let query = "SELECT id, keycloak_id, username, email, first_name, last_name, phone, avatar_url, status, created_at, updated_at FROM eventify_users";
    let params = [];

    if (keycloak_id) {
      query += " WHERE keycloak_id = $1";
      params.push(keycloak_id);
    } else if (search) {
      query += " WHERE username ILIKE $1 OR email ILIKE $1";
      params.push(`%${search}%`);
    }

    const result = await pool.query(query, params);

    // If looking for a specific user by keycloak_id, also get their organization info
    if (keycloak_id && result.rows.length > 0) {
      const user = result.rows[0];
      const orgQuery = `
        SELECT ou.organization_id, ou.role, o.name as organization_name, o.keycloak_org_id
        FROM eventify_organization_users ou
        JOIN eventify_organizations o ON ou.organization_id = o.id
        WHERE ou.user_id = $1
      `;
      const orgResult = await pool.query(orgQuery, [user.id]);
      user.eventify_organizations = orgResult.rows;
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching eventify_users:", err.message, err.stack);
    res
      .status(500)
      .json({ error: "Error fetching eventify_users", detail: err.message });
  }
});

// POST /eventify_users
router.post("/", async (req, res) => {
  // Username is intentionally ignored; we derive it from names/email
  const { keycloak_id, email, role } = req.body;
  const firstNameRaw = (req.body.first_name || "").trim();
  const lastNameRaw = (req.body.last_name || "").trim();

  // Validate required fields and UUID (relaxed: only keycloak_id + email required)
  if (!keycloak_id || !email) {
    console.warn("Invalid request:", { keycloak_id, email });
    return res
      .status(400)
      .json({ error: "Missing required fields: keycloak_id, email" });
  }
  if (!isUuid(keycloak_id)) {
    console.warn("Invalid keycloak_id:", keycloak_id);
    return res
      .status(400)
      .json({ error: "Invalid keycloak_id: Must be a valid UUID" });
  }

  // Derive a safe username from first/last name with fallbacks
  const makeSlug = (s) => String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const givenSlug = makeSlug(firstNameRaw);
  const familySlug = makeSlug(lastNameRaw);
  let derivedUsername = [givenSlug, familySlug].filter(Boolean).join(".");
  if (!derivedUsername) {
    const emailUser = String(email).split("@")[0] || "user";
    derivedUsername = makeSlug(emailUser);
  }
  const effectiveUsername = derivedUsername || "user";

  let clientInfo = null;
  let userId;
  let orgIdInDb;
  let kcOrgId = null;

  // Normalize requested creator role; default to 'orgAdmin'
  const normalizedCreatorRole = (() => {
    const requested = String(role || '').trim().toLowerCase();
    if (requested === 'organizer') return 'organizer';
    if (requested === 'user') return 'user';
    if (requested === 'orgadmin' || requested === 'org_admin' || requested === 'admin') return 'orgAdmin';
    return 'orgAdmin';
  })();

  try {
    console.log("Starting user registration:", { keycloak_id, username: effectiveUsername });

    // Create or update user first (outside transaction to ensure it's committed)
    const userRes = await pool.query(
      `INSERT INTO eventify_users (keycloak_id, username, email, first_name, last_name, phone, avatar_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (keycloak_id)
       DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = EXCLUDED.phone, avatar_url = EXCLUDED.avatar_url, status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
       RETURNING id, username`,
      [keycloak_id, effectiveUsername, email, firstNameRaw || null, lastNameRaw || null, req.body.phone || null, req.body.avatar_url || null, 'active']
    );
    userId = userRes.rows[0].id;
    console.log("User created/updated:", { userId });

    // Start transaction for organization operations
    await pool.query("BEGIN");

    // Define and sanitize orgName preferring last name, else first name; fallback to email/user
    const emailUserPart = String(email).split("@")[0] || effectiveUsername;
    const nameForOrg = lastNameRaw || firstNameRaw || emailUserPart;
    const baseOrgName = nameForOrg;
    const orgName = sanitizeOrgName(baseOrgName);
    const domain = generateDomain(orgName); // e.g., org-of-demo19.org

    // Create organization in Keycloak using Organizations API
    try {
      const accessToken = await getKeycloakAdminToken();
      // CREATE CLIENT FOR USER
      try {
        clientInfo = await createKeycloakClient(accessToken, effectiveUsername);
        console.log("✅ Client created for user:", clientInfo);

        // CREATE 3 DEFAULT ROLES FOR CLIENT
        if (clientInfo && clientInfo.clientUuid) {
          for (const roleName of ["orgAdmin", "organizer", "user"]) {
            await createClientRole(
              accessToken,
              clientInfo.clientUuid,
              roleName
            );
          }
          // Map 'orgAdmin' role to the registering user
          try {
            const userExistsForRole = await checkUserExists(
              accessToken,
              keycloak_id
            );
            if (!userExistsForRole) {
              console.warn(
                "User does not exist in Keycloak, skipping role mapping:",
                { keycloak_id }
              );
            } else {
              const orgAdminRole = await retry(
                () =>
                  getClientRoleByName(
                    accessToken,
                    clientInfo.clientUuid,
                    "orgAdmin"
                  ),
                5,
                500
              );
              await assignClientRoleToUser(
                accessToken,
                keycloak_id,
                clientInfo.clientUuid,
                orgAdminRole
              );
            }
          } catch (roleMapErr) {
            console.warn(
              "⚠️ Failed to map orgAdmin role to user:",
              roleMapErr?.message || roleMapErr
            );
          }
        }
      } catch (clientErr) {
        console.warn("⚠️ Client creation failed, proceeding without client:", {
          message: clientErr.message,
          username: username,
        });
      }

      try {
        kcOrgId = await createOrganization(accessToken, orgName, domain);
        console.log("✅ Keycloak Organization created", { kcOrgId, orgName, domain });
        const userExists = await checkUserExists(accessToken, keycloak_id);
        if (!userExists) {
          console.warn("User does not exist in Keycloak, skipping organization membership:", { keycloak_id });
        } else if (kcOrgId) {
          await addMemberToOrganization(accessToken, kcOrgId, keycloak_id);
          console.log("✅ User added to Keycloak Organization", { keycloak_id, kcOrgId });
        }
      } catch (orgErr) {
        // If the Organizations API isn't available (404), fall back to Groups approach
        if (orgErr?.response?.status === 404) {
          console.warn("Organizations API not available (404). Falling back to Groups.");
          const group = await ensureGroup(accessToken, orgName);
          kcOrgId = group?.id || null;
          const userExists = await checkUserExists(accessToken, keycloak_id);
          if (!userExists) {
            console.warn("User does not exist in Keycloak, skipping group membership:", { keycloak_id });
          } else if (kcOrgId) {
            await addUserToGroup(accessToken, keycloak_id, kcOrgId);
            console.log("✅ User added to Keycloak Group", { keycloak_id, kcOrgId });
          }
        } else {
          throw orgErr;
        }
      }
    } catch (kcErr) {
      console.warn(
        "Keycloak organization creation or membership failed, proceeding with DB only:",
        {
          message: kcErr.message,
          response: kcErr.response?.data,
          status: kcErr.response?.status,
          stack: kcErr.stack,
        }
      );
      // Continue to allow DB updates
    }

    // Insert organization in PostgreSQL (handle existing eventify_organizations)
    let orgDbRes;
    try {
      orgDbRes = await pool.query(
        `INSERT INTO eventify_organizations (name, domain, keycloak_org_id, settings, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgName, domain, kcOrgId, '{"sla_hours": 24, "auto_assign": true}', 'active']
      );
    } catch (insertError) {
      // If organization already exists, get the existing one
      if (insertError.code === '23505' && insertError.constraint === 'eventify_organizations_domain_key') {
        console.log("Organization already exists, fetching existing organization:", { domain });
        orgDbRes = await pool.query(
          `SELECT id FROM eventify_organizations WHERE domain = $1`,
          [domain]
        );
      } else {
        throw insertError;
      }
    }
    orgIdInDb = orgDbRes.rows[0].id;
    console.log("PostgreSQL organization created:", { orgId: orgIdInDb });

    // Check if user is already in an organization
    const existingMembership = await pool.query(
      `SELECT organization_id, role FROM eventify_organization_users WHERE user_id = $1`,
      [userId]
    );

    if (existingMembership.rows.length > 0) {
      console.log("User already a member of organization:", {
        userId,
        existingOrgId: existingMembership.rows[0].organization_id,
        role: existingMembership.rows[0].role
      });
      orgIdInDb = existingMembership.rows[0].organization_id;
    } else {
      // Insert user as orgAdmin in their own organization
      try {
        await pool.query(
          `INSERT INTO eventify_organization_users (organization_id, user_id, role)
           VALUES ($1, $2, $3)`,
          [orgIdInDb, userId, "orgAdmin"]
        );
        console.log("User added to eventify_organization_users:", { userId, orgId: orgIdInDb });
      } catch (membershipError) {
        // If user is already a member, that's fine - just log it
        if (membershipError.code === '23505') {
          console.log("User already a member of organization:", { userId, orgId: orgIdInDb });
        } else {
          throw membershipError;
        }
      }
    }

    await pool.query("COMMIT");
    console.log("Transaction committed for user:", { keycloak_id });

    res.status(201).json({
      id: userId,
      email: email,
      userId,
      organizationId: orgIdInDb,
      keycloakOrgId: kcOrgId || null,
      clientId: clientInfo?.clientId || null,
      message: "User, organization, and client registered successfully",
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Error registering user/org:", err.message, err.stack);
    res
      .status(500)
      .json({
        error: "User registration/org creation failed",
        detail: err.message,
      });
  }
});

module.exports = router;
