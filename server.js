
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


app.post("/api/rides/:id/assign-driver", requireAuth, async (req, res) => {
  try {
    const riderId = req.auth.userId;

    const { pickup_location, dropoff_location, ride_type, distance_km } =
      req.body;

    const allowedRideTypes = [
      "GoRide Economy",
      "GoRide Comfort",
      "GoRide XL",
    ];

    if (
      typeof pickup_location !== "string" ||
      typeof dropoff_location !== "string" ||
      !pickup_location.trim() ||
      !dropoff_location.trim()
    ) {
      return res.status(400).json({
        message: "Pickup and drop-off locations are required.",
      });
    }

    if (!allowedRideTypes.includes(ride_type)) {
      return res.status(400).json({
        message: "Please select a valid ride type.",
      });
    }

    if (
      typeof distance_km !== "number" ||
      !Number.isFinite(distance_km) ||
      distance_km <= 0 ||
      distance_km > 1000
    ) {
      return res.status(400).json({
        message: "Please provide a valid route distance.",
      });
    }

    const multiplier =
      ride_type === "GoRide Comfort"
        ? 1.5
        : ride_type === "GoRide XL"
          ? 1.8
          : 1;

    // Demo pricing; replace with server-verified routing/pricing later.
    const fare = Math.round((40 + distance_km * 15) * multiplier);

    const { data, error } = await supabase
      .from("rides")
      .insert({
        rider_id: riderId,
        pickup_location: pickup_location.trim(),
        dropoff_location: dropoff_location.trim(),
        ride_type,
        fare,
        status: "requested",
      })
      .select()
      .single();

    if (error) {
      console.error("Ride creation failed:", error.message);
      return res.status(500).json({
        message: "Could not create your ride request.",
      });
    }

    return res.status(201).json({
      message: "Ride requested successfully.",
      ride: data,
    });
  } catch (error) {
    console.error("Ride request error:", error);

    return res.status(500).json({
      message: "An unexpected error occurred while requesting your ride.",
    });
  }
});


app.post("/api/rides/:id/assign-driver", async (req, res) => {
  try {
    const { id } = req.params;
const rideId = Number(req.params.id);

if (!Number.isSafeInteger(rideId) || rideId <= 0) {
  return res.status(400).json({ message: "Invalid ride ID." });
}

    // Confirm the ride exists and has not already been assigned.
    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .select("id, status")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) throw rideError;

    if (!ride) {
      return res.status(404).json({ message: "Ride not found." });
    }

    if (ride.status !== "requested") {
      return res.status(409).json({
        message: "Only requested rides can be assigned.",
      });
    }

    // Find one available driver.
    const { data: drivers, error: driverError } = await supabase
      .from("drivers")
      .select("id, full_name, phone, vehicle_model, vehicle_number")
      .eq("is_available", true)
      .eq("status", "available")
      .limit(1);

    if (driverError) throw driverError;

    if (!drivers || drivers.length === 0) {
      return res.status(409).json({
        message: "No available drivers right now.",
      });
    }

    const driver = drivers[0];

    // Claim the driver only if they are still available.
    const { data: claimedDriver, error: claimError } = await supabase
      .from("drivers")
      .update({ is_available: false, status: "on_trip" })
      .eq("id", driver.id)
      .eq("is_available", true)
      .eq("status", "available")
      .select("id, full_name, phone, vehicle_model, vehicle_number")
      .maybeSingle();

    if (claimError) throw claimError;

    if (!claimedDriver) {
      return res.status(409).json({
        message: "Driver was just assigned elsewhere. Please try again.",
      });
    }

    const { data: updatedRide, error: updateError } = await supabase
      .from("rides")
      .update({
        status: "assigned",
        driver_id: claimedDriver.id,
      })
      .eq("id", id)
      .eq("status", "requested")
      .select()
      .maybeSingle();

    if (updateError || !updatedRide) {
      // Release the driver if the ride could not be assigned.
      await supabase
        .from("drivers")
        .update({ is_available: true, status: "available" })
        .eq("id", claimedDriver.id);

      if (updateError) throw updateError;

      return res.status(409).json({
        message: "Ride was already assigned. Please refresh and try again.",
      });
    }

    return res.json({
      message: "Driver assigned successfully.",
      ride: updatedRide,
      driver: claimedDriver,
    });
  } catch (error) {
    console.error("Driver assignment failed:", error.message);
    return res.status(500).json({
      message: "Could not assign a driver.",
    });
  }
});


// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
