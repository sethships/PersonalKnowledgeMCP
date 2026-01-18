# Simple Ruby fixture for testing AST parsing
#
# This file contains common Ruby constructs for testing:
# - Module definitions
# - Class definitions with inheritance
# - Instance methods
# - Class methods (singleton methods)
# - Method parameters (default, splat, keyword)
# - Require statements

require 'json'
require_relative './helper'

# A simple utility module
module Utils
  # A helper method
  def self.format_name(name)
    name.to_s.strip
  end
end

# User class documentation
# Represents a user in the system
class User < BaseModel
  attr_reader :name, :email

  # Initialize a new user
  def initialize(name, email = nil)
    @name = name
    @email = email
  end

  # Get the user's display name
  def display_name
    "User: #{@name}"
  end

  # Class method to create from hash
  def self.from_hash(data)
    new(data[:name], data[:email])
  end

  # Method with various parameter types
  def update(*args, **kwargs, &block)
    args.each { |arg| process(arg) }
    kwargs.each { |k, v| set_attribute(k, v) }
    block.call if block_given?
  end

  # Method with keyword parameters
  def configure(timeout: 30, retries: 3)
    @timeout = timeout
    @retries = retries
  end
end

# Simple function at module level
def simple_function
  puts "Hello"
end

# Function with parameters
def function_with_params(a, b = 10)
  a + b
end
