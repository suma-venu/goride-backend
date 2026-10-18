
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const supabase = require("./config/supabase");
const requireAuth = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.json({
    message: "GoRide backend is running!",
  });
});

// Database health-check route
app.get("/api/health/database", async (req, res) => {
  const { error } = await supabase
    .from("profiles")
    .select("id")
    .limit(1);

  if (error) {
    console.error("Database check failed:", error.message);

    return res.status(500).json({
      message: "Database connection check failed",
      error: error.message,
      code: error.code,
    });
  }

  return res.json({
    message: "GoRide backend can query Supabase.",
  });
});

// Protected profile route
app.get("/api/profile", requireAuth, async (req, res) => {
  const userId = req.auth.userId;

  // Check whether the user already has a profile
  const { data: existingProfile, error: lookupError } =
    await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

  if (lookupError) {
    console.error("Profile lookup failed:", lookupError.message);

    return res.status(500).json({
      message: "Could not retrieve profile.",
    });
  }

  // Return the existing profile
  if (existingProfile) {
    return res.json({
      profile: existingProfile,
    });
  }

  // Create a profile for a new user
  const { data: newProfile, error: insertError } =
    await supabase
      .from("profiles")
      .insert({
        id: userId,
        role: "rider",
      })
      .select()
      .single();

  if (insertError) {
    console.error("Profile creation failed:", insertError.message);

    return res.status(500).json({
      message: "Could not create profile.",
    });
  }

  return res.status(201).json({
    profile: newProfile,
  });
});



app.patch("/api/profile", requireAuth, async (req, res) => {
  const userId = req.auth.userId;
  const { full_name, phone } = req.body;

  if (
    typeof full_name !== "string" ||
    typeof phone !== "string" ||
    !full_name.trim() ||
    !phone.trim()
  ) {
    return res.status(400).json({
      message: "Please provide your full name and phone number.",
    });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: full_name.trim(),
      phone: phone.trim(),
    })
    .eq("id", userId)
    .select("id, full_name, phone, role")
    .maybeSingle();

  if (error) {
    console.error("Profile update failed:", error.message);
    return res.status(500).json({
      message: "Could not update your profile.",
    });
  }

  if (!data) {
    return res.status(404).json({
      message: "Profile not found. Load your profile before updating it.",
    });
  }

  return res.json({
    message: "Profile updated successfully.",
    profile: data,
  });
});


// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
